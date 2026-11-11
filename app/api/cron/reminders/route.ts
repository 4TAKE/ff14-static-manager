import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

type ActivityEvent = {
  id: string;
  activity_date: string;
  title: string;
  start_time: string;
  end_time: string;
  notes: string | null;
};

const REMINDER_MINUTES = 30;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function isAuthorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function jstDateString(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function jstStartTime(event: ActivityEvent): number {
  return Date.parse(`${event.activity_date}T${event.start_time.slice(0, 8)}+09:00`);
}

function displayDate(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ];
  return `${year}年${month}月${day}日（${weekday}）`;
}

function validWebhook(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["discord.com", "discordapp.com"].includes(url.hostname) &&
      /^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname) &&
      !url.username && !url.password
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("Reminder API: CRON_SECRET missing");
    return NextResponse.json({ error: "サーバー設定が不足しています。" }, { status: 500 });
  }
  if (!isAuthorized(request, secret)) {
    return NextResponse.json({ error: "認証に失敗しました。" }, { status: 401 });
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!webhook || !supabaseUrl || !supabaseSecretKey || !validWebhook(webhook)) {
    return NextResponse.json({ error: "サーバー設定が不足、またはWebhookが不正です。" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now = new Date();
  const todayJst = jstDateString(now);
  const tomorrowJst = jstDateString(new Date(now.getTime() + 86_400_000));
  const { data, error: eventsError } = await supabase
    .from("activity_events")
    .select("id, activity_date, title, start_time, end_time, notes")
    .gte("activity_date", todayJst)
    .lte("activity_date", tomorrowJst)
    .order("activity_date", { ascending: true });

  if (eventsError) {
    console.error("Reminder API: event query failed", eventsError.message);
    return NextResponse.json({ error: "活動予定の取得に失敗しました。" }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let needsReview = 0;

  for (const event of (data ?? []) as ActivityEvent[]) {
    const remainingMs = jstStartTime(event) - now.getTime();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs > REMINDER_MINUTES * 60_000) {
      skipped++;
      continue;
    }

    // RPC performs an atomic insert. A null result means another run has
    // already claimed or sent this event; never send again automatically.
    const { data: claimId, error: claimError } = await supabase.rpc(
      "claim_activity_reminder",
      { p_event_id: event.id, p_minutes: REMINDER_MINUTES }
    );
    if (claimError) {
      console.error("Reminder API: claim failed", event.id, claimError.message);
      failed++;
      continue;
    }
    if (!claimId) {
      skipped++;
      continue;
    }

    const message = {
      username: "FF14 Static Manager",
      allowed_mentions: { parse: [] as string[] },
      embeds: [{
        title: "⏰ まもなく固定活動が始まります！",
        description: "活動開始30分前のリマインダーです。準備をお願いします！",
        color: 0x5865f2,
        fields: [
          { name: "活動日", value: displayDate(event.activity_date), inline: true },
          { name: "開始時刻", value: event.start_time.slice(0, 5), inline: true },
          { name: "活動内容", value: event.title.slice(0, 1024) || "固定活動" },
        ],
        footer: { text: "FF14 Static Manager / 自動リマインダー" },
      }],
    };

    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        const { data: updated, error: markError } = await supabase
          .from("activity_reminders")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", claimId)
          .eq("status", "processing")
          .select("id");
        if (markError || !updated?.length) {
          console.error("Reminder API: Discord accepted but status update failed", event.id, markError?.message);
          needsReview++;
        } else {
          sent++;
        }
        continue;
      }

      // An explicit Discord rejection is a definite failure. A 429 may be
      // transient; release the claim for the next scheduled attempt.
      console.error("Reminder API: Discord rejected request", event.id, response.status);
      const { error: releaseError } = await supabase
        .from("activity_reminders")
        .delete()
        .eq("id", claimId)
        .eq("status", "processing");
      if (releaseError) {
        console.error("Reminder API: failed to release rejected claim", event.id, releaseError.message);
        needsReview++;
      }
      failed++;
    } catch (err) {
      // A timeout / network error is ambiguous: Discord may have delivered.
      // Keep the processing row and require manual review to avoid duplicates.
      console.error("Reminder API: ambiguous delivery; manual review required", event.id,
        err instanceof Error ? err.message : "unknown");
      needsReview++;
    }
  }

  return NextResponse.json({
    ok: failed === 0 && needsReview === 0,
    checked: (data ?? []).length,
    sent,
    skipped,
    failed,
    needs_review: needsReview,
    checked_at: now.toISOString(),
  }, { status: failed > 0 || needsReview > 0 ? 500 : 200 });
}
