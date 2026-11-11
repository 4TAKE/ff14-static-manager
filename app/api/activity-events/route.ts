import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type Action = "confirm" | "update" | "cancel";
type ActivityEvent = {
  id: string;
  activity_date: string;
  title: string;
  start_time: string;
  end_time: string;
  notes: string | null;
};

const EVENT_FIELDS = "id, activity_date, title, start_time, end_time, notes";
const isDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const isTime = (s: unknown): s is string =>
  typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function formatTime(start: string, end: string) {
  const a = start.slice(0, 5);
  const b = end.slice(0, 5);
  return `${a}〜${b <= a ? "翌" : ""}${b}`;
}

async function sendDiscord(action: Action, event: ActivityEvent) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return "DISCORD_WEBHOOK_URL が設定されていません。";
  let url: URL;
  try {
    url = new URL(webhook);
    if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) || !url.pathname.startsWith("/api/webhooks/")) {
      return "Discord Webhook URLが正しくありません。";
    }
  } catch {
    return "Discord Webhook URLが正しくありません。";
  }

  const labels: Record<Action, string> = {
    confirm: "📅 固定活動日が確定しました！",
    update: "✏️ 固定活動予定が更新されました！",
    cancel: "❌ 固定活動予定が取り消されました。",
  };
  const description = [
    `**活動日：** ${event.activity_date}`,
    `**活動時間：** ${formatTime(event.start_time, event.end_time)}`,
    `**活動内容：** ${event.title}`,
    ...(event.notes ? [`**備考：** ${event.notes}`] : []),
  ].join("\n");

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "FF14 Static Manager",
        allowed_mentions: { parse: [] },
        embeds: [{ title: labels[action], description, color: action === "cancel" ? 0xef4444 : action === "update" ? 0x38bdf8 : 0x8b5cf6 }],
      }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("Discord webhook failed", response.status);
      return `Discord通知に失敗しました（HTTP ${response.status}）。`;
    }
    return null;
  } catch (error) {
    console.error("Discord webhook error", error);
    return "Discordへの接続に失敗しました。";
  }
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ error: "許可されていない送信元です。" }, { status: 403 });
    }
    if (Number(request.headers.get("content-length") || 0) > 10000) {
      return NextResponse.json({ error: "リクエストが大きすぎます。" }, { status: 413 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(items) {
            try {
              items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
            } catch { /* Server cookie writes may be unavailable in some contexts. */ }
          },
        },
      }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Discordでログインしてください。" }, { status: 401 });

    const { data: admin, error: memberError } = await supabase
      .from("static_members").select("id, is_admin")
      .eq("user_id", user.id).eq("is_admin", true).maybeSingle();
    if (memberError || !admin) return NextResponse.json({ error: "管理者のみ操作できます。" }, { status: 403 });

    let body: Record<string, unknown>;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "入力データが正しくありません。" }, { status: 400 }); }
    const action = body.action;
    if (action !== "confirm" && action !== "update" && action !== "cancel") {
      return NextResponse.json({ error: "操作が正しくありません。" }, { status: 400 });
    }

    let event: ActivityEvent;
    if (action === "confirm") {
      if (!isDate(body.activity_date)) return NextResponse.json({ error: "活動日が正しくありません。" }, { status: 400 });
      const { data, error } = await supabase.from("activity_events")
        .insert({ activity_date: body.activity_date, title: "固定活動", start_time: "21:30:00", end_time: "00:30:00", created_by: user.id })
        .select(EVENT_FIELDS).single();
      if (error || !data) return NextResponse.json({ error: error?.code === "23505" ? "この日は既に確定されています。画面を再読み込みしてください。" : (error?.message ?? "確定に失敗しました。") }, { status: 409 });
      event = data as ActivityEvent;
    } else {
      if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
        return NextResponse.json({ error: "活動予定IDが正しくありません。" }, { status: 400 });
      }
      const { data: existing, error: lookupError } = await supabase.from("activity_events")
        .select(EVENT_FIELDS).eq("id", body.id).maybeSingle();
      if (lookupError || !existing) return NextResponse.json({ error: "活動予定が見つかりません。画面を再読み込みしてください。" }, { status: 404 });

      if (action === "update") {
        if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120 ||
            !isTime(body.start_time) || !isTime(body.end_time) || body.start_time === body.end_time ||
            typeof body.notes !== "string" || body.notes.length > 3000) {
          return NextResponse.json({ error: "タイトル・時刻・備考を確認してください。" }, { status: 400 });
        }
        const changes = {
          title: body.title.trim(), start_time: `${body.start_time}:00`,
          end_time: `${body.end_time}:00`, notes: body.notes.trim() || null,
        };
        const before = existing as ActivityEvent;
        if (before.title === changes.title && before.start_time.slice(0, 5) === body.start_time &&
            before.end_time.slice(0, 5) === body.end_time && before.notes === changes.notes) {
          return NextResponse.json({ event: before, notificationWarning: null, unchanged: true });
        }
        const { data, error } = await supabase.from("activity_events")
          .update({ ...changes, updated_at: new Date().toISOString() })
          .eq("id", body.id).select(EVENT_FIELDS).single();
        if (error || !data) return NextResponse.json({ error: error?.message ?? "変更に失敗しました。" }, { status: 500 });
        event = data as ActivityEvent;
      } else {
        const { data, error } = await supabase.from("activity_events")
          .delete().eq("id", body.id).select(EVENT_FIELDS).single();
        if (error || !data) return NextResponse.json({ error: error?.message ?? "取り消しに失敗しました。" }, { status: 500 });
        event = data as ActivityEvent;
      }
    }

    const notificationWarning = await sendDiscord(action, event);
    return NextResponse.json({ event, notificationWarning, unchanged: false });
  } catch (error) {
    console.error("Activity API error", error);
    return NextResponse.json({ error: "サーバーでエラーが発生しました。" }, { status: 500 });
  }
}
