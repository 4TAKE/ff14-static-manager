"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
const members = ["MT", "ST", "H1", "H2", "D1", "D2", "D3", "D4"];
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
type Preparation = {
  id: string;
  activity_event_id: string;
  title: string;
  description: string | null;
  resource_url: string | null;
};
type ActivityEvent = {
  id: string;
  activity_date: string;
  title: string;
  start_time: string;
  end_time: string;
  notes: string | null;
};
function parseDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function formatActivityDate(date: string) {
  const day = parseDate(date);
  return `${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日（${weekdays[day.getDay()]}）`;
}
function formatShortDate(date: string) {
  const day = parseDate(date);
  return `${day.getMonth() + 1}/${day.getDate()}（${weekdays[day.getDay()]}）`;
}
function formatTime(time: string) {
  return time.slice(0, 5);
}
function isOvernight(event: ActivityEvent) {
  return event.end_time <= event.start_time;
}
function formatActivityTime(event: ActivityEvent) {
  return `${formatTime(event.start_time)}〜${isOvernight(event) ? "翌" : ""}${formatTime(event.end_time)}`;
}
function eventStart(event: ActivityEvent) {
  const start = parseDate(event.activity_date);
  const [hour, minute] = event.start_time.split(":").map(Number);
  start.setHours(hour, minute, 0, 0);
  return start;
}
function eventEnd(event: ActivityEvent) {
  const end = parseDate(event.activity_date);
  const [hour, minute] = event.end_time.split(":").map(Number);
  if (isOvernight(event)) end.setDate(end.getDate() + 1);
  end.setHours(hour, minute, 0, 0);
  return end;
}
function dateForQuery(now: Date) {
  // 前日の深夜にまたがる活動も取得するため、検索開始日は前日とする。
  const previous = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}-${String(previous.getDate()).padStart(2, "0")}`;
}
function countdownLabel(event: ActivityEvent, now: Date) {
  const start = eventStart(event);
  const end = eventEnd(event);
  if (now >= start && now < end) return "活動中";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = parseDate(event.activity_date);
  const diff = Math.round((Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";
  return `あと${diff}日`;
}
export default function Home() {
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [now, setNow] = useState<Date | null>(null);
  const [preparations, setPreparations] = useState<Preparation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [access, setAccess] = useState<"loading" | "member" | "guest" | "unregistered" | "signed-out">("loading");
  useEffect(() => {
    let active = true;
    async function loadActivities() {
      setLoading(true);
      setError("");
      try {
        const current = new Date();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (active) {
          setAuthUser(authData.user ?? null);
          setAuthLoading(false);
        }
        if (authError || !authData.user) {
          if (active) setAccess("signed-out");
          throw new Error("Discordでログインしてください。");
        }
        // 登録済み固定メンバーか、閲覧専用ゲストかを判定する。
        const { data: memberData, error: memberError } = await supabase
          .from("static_members")
          .select("id")
          .eq("user_id", authData.user.id)
          .limit(1);
        if (memberError) throw memberError;
        let currentAccess: "member" | "guest" | "unregistered" = "member";
        if (!memberData?.length) {
          const { data: guestData, error: guestError } = await supabase
            .from("static_guests")
            .select("user_id")
            .eq("user_id", authData.user.id)
            .limit(1);
          if (guestError) throw guestError;
          currentAccess = guestData?.length ? "guest" : "unregistered";
        }
        if (active) setAccess(currentAccess);
        if (currentAccess === "unregistered") {
          // 登録前のユーザーには活動情報を取得しない。
          if (active) {
            setActivities([]);
            setPreparations([]);
            setNow(current);
          }
          return;
        }
        const { data, error: activityError } = await supabase
          .from("activity_events")
          .select("id, activity_date, title, start_time, end_time, notes")
          .gte("activity_date", dateForQuery(current))
          .order("activity_date", { ascending: true });
        if (activityError) throw activityError;
        // 予習情報も同時に取得する。未登録なら空配列のまま。
        const upcomingEvents = ((data ?? []) as ActivityEvent[])
          .filter((event) => eventEnd(event).getTime() > current.getTime())
          .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
        let preparationRows: Preparation[] = [];
        if (upcomingEvents.length > 0) {
          const { data: preparationData, error: preparationError } = await supabase
            .from("activity_preparations")
            .select("id, activity_event_id, title, description, resource_url")
            .in("activity_event_id", upcomingEvents.map((event) => event.id));
          if (preparationError) throw preparationError;
          preparationRows = (preparationData ?? []) as Preparation[];
        }
        if (active) {
          setActivities(upcomingEvents);
          setPreparations(preparationRows);
          setNow(current);
        }
      } catch (err) {
        if (active) {
          setActivities([]);
          setPreparations([]);
          setError(err instanceof Error ? err.message : "活動予定の取得に失敗しました。");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadActivities();
    // ページを再表示したときにも予定を再取得する。
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadActivities();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  async function handleSignOut() {
    setSigningOut(true);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(`ログアウトに失敗しました：${signOutError.message}`);
      setSigningOut(false);
      return;
    }
    setAuthUser(null);
    setAccess("signed-out");
    window.location.assign("/login");
  }

  const discordName =
    authUser?.user_metadata?.full_name ??
    authUser?.user_metadata?.name ??
    authUser?.user_metadata?.user_name ??
    authUser?.email ??
    "ログイン中";
  const discordAvatar = authUser?.user_metadata?.avatar_url;

  const nextActivity = activities[0] ?? null;
  const nextPreparation = nextActivity
    ? preparations.find((item) => item.activity_event_id === nextActivity.id) ?? null
    : null;
  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white md:p-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="border-b border-slate-800 pb-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium text-cyan-400">FF14 STATIC MANAGER</p>
              <h1 className="mt-2 text-3xl font-bold">固定活動ダッシュボード</h1>
              <p className="mt-2 text-slate-400">活動予定・日程調整・予習範囲をまとめて管理</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {authLoading ? (
                <span className="text-sm text-slate-400">ログイン状態を確認中...</span>
              ) : authUser ? (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
                    {typeof discordAvatar === "string" && discordAvatar.startsWith("https://") ? (
                      <img
                        src={discordAvatar}
                        alt="Discordアバター"
                        referrerPolicy="no-referrer"
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700">👤</span>
                    )}
                    <span className="max-w-36 truncate text-sm font-medium" title={String(discordName)}>
                      {String(discordName)}
                    </span>
                  </div>
                  <Link
                    href="/profile"
                    className="rounded-lg border border-cyan-700 px-3 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-950"
                  >
                    プロフィール
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {signingOut ? "ログアウト中..." : "ログアウト"}
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-500"
                >
                  Discordでログイン
                </Link>
              )}
            </div>
          </div>
        </header>
        {access === "unregistered" && (
          <section className="rounded-xl border border-amber-700 bg-amber-950/30 p-5" role="status">
            <h2 className="text-lg font-bold text-amber-200">初回登録が必要です</h2>
            <p className="mt-2 text-sm text-slate-200">プロフィール画面で固定メンバーのポジションを選ぶか、閲覧専用ゲストとして登録してください。</p>
            <Link href="/profile" className="mt-4 inline-block rounded-lg bg-cyan-600 px-4 py-2 font-bold text-white hover:bg-cyan-500">登録画面へ進む →</Link>
          </section>
        )}
        {access === "guest" && (
          <section className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200" role="status">
            ゲストとしてログイン中です。活動情報は閲覧できますが、出欠回答や活動予定の編集はできません。
          </section>
        )}
        <section className="grid gap-4 md:grid-cols-3">
          {[["メンバー", "8人"], ["基本活動時間", "21:30〜翌00:30"], ["活動対象", "全曜日"]].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-sm text-slate-400">{label}</p>
              <p className="mt-2 text-2xl font-bold">{value}</p>
            </div>
          ))}
        </section>
        <section>
          <h2 className="mb-4 text-xl font-bold">日程管理</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link href="/schedule" className="group rounded-xl border border-cyan-800 bg-cyan-950/30 p-6 transition hover:border-cyan-400 hover:bg-cyan-950/50">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-bold text-cyan-300">日程調整</h3>
                <span className="text-2xl text-cyan-400 transition group-hover:translate-x-1">→</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">{access === "guest" ? "ゲストは日程を閲覧できます。回答の変更はできません。" : "自分の参加可能日を回答・変更できます。管理者はほかのメンバーの回答も編集できます。"}</p>
              <p className="mt-5 font-bold text-cyan-400">{access === "guest" ? "日程を確認する" : "回答を入力・編集する"}</p>
            </Link>
            <Link href="/schedule/overview" className="group rounded-xl border border-slate-700 bg-slate-900 p-6 transition hover:border-cyan-400 hover:bg-slate-800">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-bold text-white">メンバー回答一覧</h3>
                <span className="text-2xl text-cyan-400 transition group-hover:translate-x-1">→</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">固定メンバー8人の回答を一覧表示します。全員が参加可能な日も確認できます。</p>
              <p className="mt-5 font-bold text-cyan-400">回答一覧を確認する</p>
            </Link>
            <Link href="/calendar" className="group rounded-xl border border-violet-800 bg-violet-950/30 p-6 transition hover:border-violet-400 hover:bg-violet-950/50">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xl font-bold text-violet-200">活動予定カレンダー</h3>
                  <span className="text-2xl text-violet-300 transition group-hover:translate-x-1">→</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">確定済みの活動日だけを月間カレンダーで確認できます。活動内容・時間・備考もまとめてチェックできます。</p>
                <p className="mt-5 font-bold text-violet-300">カレンダーを開く</p>
            </Link>
          </div>
        </section>
        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-bold">次回活動予定</h2>
            {loading ? (
              <p className="mt-4 text-cyan-400">活動予定を読み込み中...</p>
            ) : error ? (
              <div role="alert" className="mt-4 rounded-lg bg-rose-950/40 p-3 text-sm text-rose-300">{error}</div>
            ) : nextActivity ? (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-violet-500/20 px-3 py-1 text-sm font-bold text-violet-300">確定済み</span>
                  {now && <span className="rounded-lg bg-cyan-950 px-3 py-1 text-sm font-bold text-cyan-300">{countdownLabel(nextActivity, now)}</span>}
                </div>
                <p className="mt-4 text-xl font-bold text-white">{nextActivity.title}</p>
                <p className="mt-3 text-slate-300">日付：{formatActivityDate(nextActivity.activity_date)}</p>
                <p className="mt-2 text-slate-300">時間：{formatActivityTime(nextActivity)}</p>
                {nextActivity.notes?.trim() && (
                  <div className="mt-4 rounded-lg bg-slate-800 p-4">
                    <p className="text-sm font-bold text-slate-300">連絡事項</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">{nextActivity.notes}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="mt-4 text-slate-300">次回活動日は未設定です。</p>
                <p className="mt-2 text-sm text-slate-400">管理者が活動日を確定すると、ここに表示されます。</p>
              </>
            )}
            <Link href="/schedule/overview" className="mt-5 inline-block text-sm font-medium text-cyan-400 hover:underline">活動予定一覧を見る →</Link>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-bold">次回の予習範囲</h2>
            {loading ? (
              <p className="mt-4 text-cyan-400">予習情報を読み込み中...</p>
            ) : error ? (
              <p role="alert" className="mt-4 text-sm text-rose-300">予習情報を取得できませんでした。{error}</p>
            ) : !nextActivity ? (
              <p className="mt-4 text-slate-300">次回活動日が未設定です。</p>
            ) : nextPreparation ? (
              <>
                <p className="mt-3 text-sm text-slate-400">
                  {formatShortDate(nextActivity.activity_date)}の活動に向けて
                </p>
                <p className="mt-3 text-xl font-bold text-white">{nextPreparation.title}</p>
                {nextPreparation.description?.trim() && (
                  <div className="mt-4 rounded-lg bg-slate-800 p-4">
                    <p className="text-sm font-bold text-slate-300">予習内容</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">
                      {nextPreparation.description}
                    </p>
                  </div>
                )}
                {nextPreparation.resource_url && /^https?:\/\//i.test(nextPreparation.resource_url) && (
                  <a
                    href={nextPreparation.resource_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex break-all text-sm font-medium text-cyan-400 hover:underline"
                  >
                    攻略資料を開く ↗
                  </a>
                )}
              </>
            ) : (
              <>
                <p className="mt-4 text-slate-300">予習内容は未設定です。</p>
                <p className="mt-2 text-sm text-slate-400">管理者が登録すると、ここに表示されます。</p>
              </>
            )}
            <div className="mt-5">
              <Link href="/preparations" className="text-sm font-medium text-cyan-400 hover:underline">
                予習・攻略資料を確認する →
              </Link>
            </div>
          </div>
        </section>
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">今後の活動予定</h2>
            {!loading && !error && <span className="text-sm text-slate-400">{activities.length}件</span>}
          </div>
          {loading ? (
            <p className="mt-4 text-cyan-400">読み込み中...</p>
          ) : error ? (
            <p className="mt-4 text-sm text-rose-300">活動予定を表示できません。</p>
          ) : activities.length === 0 ? (
            <p className="mt-4 text-slate-400">今後の確定済み活動予定はありません。</p>
          ) : (
            <div className="mt-4 divide-y divide-slate-800">
              {activities.map((event) => (
                <div key={event.id} className="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                  <div className="min-w-0">
                    <p className="font-bold text-white">{formatShortDate(event.activity_date)}　{event.title}</p>
                    {event.notes?.trim() && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-400">{event.notes}</p>}
                  </div>
                  <p className="shrink-0 text-sm text-cyan-300">{formatActivityTime(event)}</p>
                </div>
              ))}
            </div>
          )}
          <Link href="/schedule/overview" className="mt-5 inline-block text-sm font-medium text-cyan-400 hover:underline">活動日を確認する →</Link>
        </section>
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-bold">固定メンバー</h2>
          <div className="mt-5 grid grid-cols-4 gap-3 md:grid-cols-8">
            {members.map((member) => (
              <div key={member} className="rounded-lg bg-slate-800 p-3 text-center font-bold sm:p-4">{member}</div>
            ))}
          </div>
        </section>
        <footer className="pt-4 text-center text-sm text-slate-500">FF14 Static Manager — Development Version</footer>
      </div>
    </main>
  );
}
