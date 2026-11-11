
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

const ROLES = ["MT", "ST", "H1", "H2", "D1", "D2", "D3", "D4"];
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

type Answer = "○" | "×" | "未定";
type Answers = Record<string, Answer>;

type Member = {
  id: string;
  role: string;
  user_id: string | null;
  is_admin: boolean;
};

type ScheduleRow = {
  member_id: string;
  activity_date: string;
  answer: Answer;
};

type ActivityEvent = {
  id: string;
  activity_date: string;
  title: string;
  start_time: string;
  end_time: string;
  notes: string | null;
};

function formatActivityTime(start: string, end: string) {
  const a = start.slice(0, 5);
  const b = end.slice(0, 5);
  return `${a}〜${b <= a ? "翌" : ""}${b}`;
}

function dateString(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function answerStyle(answer?: Answer) {
  if (answer === "○") return "text-emerald-400";
  if (answer === "×") return "text-rose-400";
  if (answer === "未定") return "text-amber-400";
  return "text-slate-500";
}

export default function ScheduleOverviewPage() {
  // 初期描画では固定日付を使用し、ブラウザで現在月を設定
  const [month, setMonth] = useState(new Date(2026, 0, 1));
  const [ready, setReady] = useState(false);

  const [answers, setAnswers] = useState<Answers>({});
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [myMember, setMyMember] = useState<Member | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStart, setEditStart] = useState("21:30");
  const [editEnd, setEditEnd] = useState("00:30");
  const [editNotes, setEditNotes] = useState("");
  const [dialogError, setDialogError] = useState("");

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const isAdmin = myMember?.is_admin === true;
  const canView = Boolean(myMember) || isGuest;

  useEffect(() => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;

    let active = true;

    async function loadData() {
      setLoading(true);
      setError("");

      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser();

        if (authError || !authData.user) {
          throw new Error("Discordでログインしてください。");
        }

        const { data: memberData, error: memberError } =
          await supabase
            .from("static_members")
            .select("id, role, user_id, is_admin");

        if (memberError) throw memberError;

        const members = (memberData ?? []) as Member[];
        const mine = members.find(
          (m) => m.user_id === authData.user.id
        );

        let guest = false;
        if (!mine) {
          const { data: guestData, error: guestError } = await supabase
            .from("static_guests")
            .select("user_id")
            .eq("user_id", authData.user.id)
            .maybeSingle();
          if (guestError) throw guestError;
          guest = Boolean(guestData);
          if (!guest) {
            if (active) {
              setNeedsRegistration(true);
              setIsGuest(false);
              setMyMember(null);
              setAnswers({});
              setEvents([]);
            }
            return;
          }
        }

        const start = dateString(year, monthIndex, 1);
        const end = dateString(year, monthIndex, daysInMonth);

        const [answerResult, eventResult] = await Promise.all([
          supabase
            .from("schedule_answers")
            .select("member_id, activity_date, answer")
            .gte("activity_date", start)
            .lte("activity_date", end),

          supabase
            .from("activity_events")
            .select("id, activity_date, title, start_time, end_time, notes")
            .gte("activity_date", start)
            .lte("activity_date", end),
        ]);

        if (answerResult.error) throw answerResult.error;
        if (eventResult.error) throw eventResult.error;

        if (!active) return;

        const next: Answers = {};

        for (const row of (answerResult.data ?? []) as ScheduleRow[]) {
          const member = members.find((m) => m.id === row.member_id);
          if (member) {
            next[`${row.activity_date}-${member.role}`] = row.answer;
          }
        }

        setMyMember(mine ?? null);
        setIsGuest(guest);
        setNeedsRegistration(false);
        setAnswers(next);
        setEvents((eventResult.data ?? []) as ActivityEvent[]);
      } catch (err) {
        if (active) {
          setMyMember(null);
          setIsGuest(false);
          setNeedsRegistration(false);
          setAnswers({});
          setEvents([]);
          setError(
            err instanceof Error
              ? err.message
              : "データの取得に失敗しました。"
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, [ready, year, monthIndex, daysInMonth]);

  function getAnswer(day: number, role: string) {
    return answers[`${dateString(year, monthIndex, day)}-${role}`];
  }

  function getSummary(day: number) {
    const values = ROLES.map((role) => getAnswer(day, role));
    const yes = values.filter((v) => v === "○").length;
    const no = values.filter((v) => v === "×").length;
    const pending = values.filter((v) => v === "未定").length;

    return {
      yes,
      no,
      pending,
      unanswered: 8 - yes - no - pending,
      allYes: yes === 8,
    };
  }

  function getEvent(day: number) {
    const date = dateString(year, monthIndex, day);
    return events.find((event) => event.activity_date === date);
  }

  function changeMonth(offset: number) {
    if (saving) return;

    setSelectedDay(null);
    setDialogError("");
    setNotice("");
    setMonth(new Date(year, monthIndex + offset, 1));
  }

  function openDialog(day: number) {
    if (!isAdmin || loading || saving) return;
    const event = getEvent(day);
    setEditTitle(event?.title ?? "固定活動");
    setEditStart(event?.start_time.slice(0, 5) ?? "21:30");
    setEditEnd(event?.end_time.slice(0, 5) ?? "00:30");
    setEditNotes(event?.notes ?? "");
    setDialogError("");
    setSelectedDay(day);
  }

  async function callActivityApi(payload: Record<string, unknown>) {
    const response = await fetch("/api/activity-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "操作に失敗しました。");
    return result as {
      event: ActivityEvent;
      notificationWarning: string | null;
      unchanged: boolean;
    };
  }

  function notificationMessage(message: string, warning: string | null) {
    return warning ? `${message} ただし、${warning}（予定の保存は完了しています）` : `${message} Discordにも通知しました。`;
  }

  async function saveActivityDetails() {
    if (!isAdmin || saving || loading || selectedDay === null) return;
    const event = getEvent(selectedDay);
    if (!event) return;
    const title = editTitle.trim();
    if (!title) { setDialogError("活動タイトルを入力してください。"); return; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(editStart) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(editEnd) || editStart === editEnd) {
      setDialogError("開始時刻と終了時刻を正しく入力してください。"); return;
    }
    setSaving(true); setDialogError(""); setError(""); setNotice("");
    try {
      const result = await callActivityApi({
        action: "update", id: event.id, title,
        start_time: editStart, end_time: editEnd, notes: editNotes,
      });
      setEvents(prev => prev.map(item => item.id === event.id ? result.event : item));
      setSelectedDay(null);
      setNotice(result.unchanged ? "変更内容はありませんでした。" : notificationMessage(`${event.activity_date}の活動予定を更新しました。`, result.notificationWarning));
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "変更の保存に失敗しました。");
    } finally { setSaving(false); }
  }

  async function confirmActivity(day: number) {
    if (!isAdmin || saving || loading) return;
    const date = dateString(year, monthIndex, day);
    setSaving(true); setDialogError(""); setError(""); setNotice("");
    try {
      const result = await callActivityApi({ action: "confirm", activity_date: date });
      setEvents(prev => [...prev.filter(item => item.id !== result.event.id), result.event]);
      setSelectedDay(null);
      setNotice(notificationMessage(`${monthIndex + 1}月${day}日を活動日として確定しました。`, result.notificationWarning));
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "活動日の確定に失敗しました。");
    } finally { setSaving(false); }
  }

  async function cancelActivity(day: number) {
    if (!isAdmin || saving || loading) return;
    const event = getEvent(day);
    if (!event) return;
    if (!window.confirm(`${event.activity_date}の活動予定を取り消しますか？\n紐づく予習情報も削除されます。`)) return;
    setSaving(true); setDialogError(""); setError(""); setNotice("");
    try {
      const result = await callActivityApi({ action: "cancel", id: event.id });
      setEvents(prev => prev.filter(item => item.id !== event.id));
      setSelectedDay(null);
      setNotice(notificationMessage(`${monthIndex + 1}月${day}日の活動予定を取り消しました。`, result.notificationWarning));
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "活動予定の取り消しに失敗しました。");
    } finally { setSaving(false); }
  }

  const days = Array.from(
    { length: daysInMonth },
    (_, index) => index + 1
  );

  const availableDays = days.filter(
    (day) => getSummary(day).allYes
  ).length;

  const confirmedDays = events.length;

  const selectedSummary =
    selectedDay !== null ? getSummary(selectedDay) : null;

  const selectedEvent =
    selectedDay !== null ? getEvent(selectedDay) : null;

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">

        <header>
          <a href="/" className="text-sm text-cyan-400 hover:underline">
            ← ダッシュボードに戻る
          </a>

          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold">メンバー回答一覧</h1>
              <p className="mt-2 text-slate-400">
                8人の参加可否と確定した活動日を確認できます。
              </p>
            </div>

            <a
              href="/schedule"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-cyan-600 px-5 py-3 text-center font-bold hover:bg-cyan-500"
            >
              {isGuest ? "← 日程調整を閲覧する" : "← 日程を入力・編集する"}
            </a>
          </div>
        </header>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              disabled={saving || !ready}
              className="rounded-lg bg-slate-800 px-4 py-3 text-lg hover:bg-slate-700 disabled:opacity-50"
            >
              ←
            </button>

            <h2 className="text-center text-xl font-bold md:text-2xl">
              {ready ? `${year}年${monthIndex + 1}月` : "読み込み中"}
            </h2>

            <button
              type="button"
              onClick={() => changeMonth(1)}
              disabled={saving || !ready}
              className="rounded-lg bg-slate-800 px-4 py-3 text-lg hover:bg-slate-700 disabled:opacity-50"
            >
              →
            </button>
          </div>

          {!loading && canView && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-emerald-950/30 p-4 text-center">
                <p className="text-sm text-slate-300">
                  8人全員が参加可能な日
                </p>
                <p className="mt-1 text-3xl font-bold text-emerald-400">
                  {availableDays}日
                </p>
              </div>

              <div className="rounded-lg bg-violet-950/40 p-4 text-center">
                <p className="text-sm text-slate-300">
                  確定した活動日
                </p>
                <p className="mt-1 text-3xl font-bold text-violet-300">
                  {confirmedDays}日
                </p>
              </div>
            </div>
          )}
        </section>

        {loading && (
          <p className="text-center text-cyan-400">
            回答データを読み込み中...
          </p>
        )}

        {error && (
          <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-rose-300">
            {error}
          </div>
        )}

        {!loading && isGuest && !error && (
          <div className="rounded-xl border border-cyan-800 bg-cyan-950/30 p-4 text-sm text-cyan-200">
            ゲストとして閲覧中です。回答や活動予定の変更はできません。
          </div>
        )}

        {!loading && needsRegistration && !error && (
          <div className="rounded-xl border border-amber-800 bg-amber-950/30 p-5 text-amber-100">
            <p className="font-bold">初回登録が必要です</p>
            <p className="mt-2 text-sm">固定メンバーまたはゲストとして登録すると、回答一覧を閲覧できます。</p>
            <a href="/profile" className="mt-4 inline-block rounded-lg bg-cyan-600 px-4 py-3 font-bold text-white hover:bg-cyan-500">プロフィールで登録する →</a>
          </div>
        )}

        {notice && (
          <div role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-4 text-emerald-300">
            {notice}
          </div>
        )}

        {!loading && canView && (
          <>
            {/* PC版：一覧表 */}
            <section className="hidden overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 md:block">
              <table className="w-full min-w-[850px] border-collapse text-center">
                <thead className="bg-slate-800">
                  <tr>
                    <th className="px-3 py-4">日付</th>
                    {ROLES.map((role) => (
                      <th key={role} className="px-2 py-4">{role}</th>
                    ))}
                    <th className="px-3 py-4">参加</th>
                    <th className="px-3 py-4">活動</th>
                  </tr>
                </thead>

                <tbody>
                  {days.map((day) => {
                    const weekday = new Date(year, monthIndex, day).getDay();
                    const summary = getSummary(day);
                    const event = getEvent(day);

                    const background = event
                      ? "bg-violet-950/40"
                      : summary.allYes
                        ? "bg-emerald-950/40"
                        : weekday === 0
                          ? "bg-rose-950/30"
                          : weekday === 6
                            ? "bg-blue-950/30"
                            : "";

                    return (
                      <tr key={day} className={`border-t border-slate-800 ${background}`}>
                        <td className="whitespace-nowrap px-3 py-4 font-bold">
                          {monthIndex + 1}/{day}
                          <span className="ml-1 text-slate-400">
                            ({WEEKDAYS[weekday]})
                          </span>
                        </td>

                        {ROLES.map((role) => {
                          const answer = getAnswer(day, role);

                          return (
                            <td
                              key={role}
                              className={`px-2 py-4 text-xl font-bold ${answerStyle(answer)}`}
                            >
                              {answer ?? "—"}
                            </td>
                          );
                        })}

                        <td className="px-3 py-4 font-bold">
                          {summary.yes}/8
                        </td>

                        <td className="px-3 py-4">
                          {event ? (
                            <span className="font-bold text-violet-300">
                              確定済み
                              <span className="mt-1 block text-xs font-normal text-slate-300">
                                {event.title}
                              </span>
                              <span className="mt-1 block whitespace-nowrap text-xs font-normal text-slate-300">
                                {formatActivityTime(event.start_time, event.end_time)}
                              </span>
                              {event.notes && (
                                <span className="mt-1 block max-w-44 break-words text-xs font-normal text-slate-300">
                                  {event.notes}
                                </span>
                              )}
                            </span>
                          ) : isAdmin ? (
                            <button
                              type="button"
                              onClick={() => openDialog(day)}
                              className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-bold hover:bg-cyan-600"
                            >
                              確定する
                            </button>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}

                          {event && isAdmin && (
                            <button
                              type="button"
                              onClick={() => openDialog(day)}
                              className="mt-2 block w-full text-xs text-violet-300 underline"
                            >
                              管理
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {/* スマートフォン版：カード表示 */}
            <section className="space-y-3 md:hidden">
              {days.map((day) => {
                const weekday = new Date(year, monthIndex, day).getDay();
                const summary = getSummary(day);
                const event = getEvent(day);

                const background = event
                  ? "border-violet-500 bg-violet-950/30"
                  : summary.allYes
                    ? "border-emerald-400 bg-emerald-950/20"
                    : weekday === 0
                      ? "border-rose-900 bg-rose-950/30"
                      : weekday === 6
                        ? "border-blue-900 bg-blue-950/30"
                        : "border-slate-800 bg-slate-900";

                return (
                  <div key={day} className={`rounded-xl border p-4 ${background}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold">
                        {monthIndex + 1}/{day}
                        <span className="ml-2 text-base text-slate-300">
                          ({WEEKDAYS[weekday]})
                        </span>
                      </h3>

                      <span className="font-bold text-slate-300">
                        {summary.yes}/8人
                      </span>
                    </div>

                    {event && (
                      <div className="mt-3 rounded-lg bg-violet-500/20 p-2 text-center font-bold text-violet-200">
                        <p>活動日確定済み</p>
                        <p className="mt-1">{event.title}</p>
                        <p className="mt-1">{formatActivityTime(event.start_time, event.end_time)}</p>
                        {event.notes && <p className="mt-2 whitespace-pre-wrap text-sm font-normal">{event.notes}</p>}
                      </div>
                    )}

                    <div className="mt-4 grid grid-cols-4 gap-2">
                      {ROLES.map((role) => {
                        const answer = getAnswer(day, role);

                        return (
                          <div key={role} className="rounded-lg bg-slate-800/80 p-2 text-center">
                            <div className="text-xs text-slate-400">{role}</div>
                            <div className={`mt-1 text-2xl font-bold ${answerStyle(answer)}`}>
                              {answer ?? "—"}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => openDialog(day)}
                        className={`mt-4 w-full rounded-lg px-4 py-3 font-bold ${
                          event
                            ? "bg-violet-700 hover:bg-violet-600"
                            : "bg-cyan-700 hover:bg-cyan-600"
                        }`}
                      >
                        {event ? "活動予定を管理する" : "活動日として確定"}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          </>
        )}

        {/* 管理者用確認ダイアログ */}
        {selectedDay !== null && isAdmin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="activity-dialog-title"
              className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            >
              <h2 id="activity-dialog-title" className="text-center text-2xl font-bold">
                {monthIndex + 1}月{selectedDay}日
              </h2>

              <p className="mt-2 text-center text-slate-400">
                {selectedEvent ? "確定済みの活動予定" : "活動日として確定しますか？"}
              </p>

              <div className="mt-5 rounded-lg bg-slate-800 p-4">
                <p className="text-sm text-slate-400">参加可能人数</p>
                <p className="mt-1 text-2xl font-bold">
                  {selectedSummary?.yes}/8人
                </p>

                {selectedSummary && selectedSummary.yes < 8 && (
                  <p className="mt-3 text-sm text-amber-300">
                    注意：全員が参加可能ではありません。
                    参加不可・未定・未回答のメンバーがいないか確認してください。
                  </p>
                )}

                <p className="mt-3 text-sm text-slate-300">
                  活動時間：{selectedEvent
                    ? formatActivityTime(selectedEvent.start_time, selectedEvent.end_time)
                    : "21:30〜翌00:30"}
                </p>
              </div>

              {selectedEvent && (
                <div className="mt-5 space-y-4">
                  <div>
                    <label htmlFor="activity-title" className="mb-1 block text-sm text-slate-300">活動タイトル</label>
                    <input id="activity-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={120}
                      className="w-full rounded-lg border border-slate-600 bg-slate-800 p-3 text-white" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="activity-start" className="mb-1 block text-sm text-slate-300">開始時刻</label>
                      <input id="activity-start" type="time" value={editStart} onChange={(e) => setEditStart(e.target.value)}
                        className="w-full min-w-0 rounded-lg border border-slate-600 bg-slate-800 p-3 text-white [color-scheme:dark]" />
                    </div>
                    <div>
                      <label htmlFor="activity-end" className="mb-1 block text-sm text-slate-300">終了時刻</label>
                      <input id="activity-end" type="time" value={editEnd} onChange={(e) => setEditEnd(e.target.value)}
                        className="w-full min-w-0 rounded-lg border border-slate-600 bg-slate-800 p-3 text-white [color-scheme:dark]" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">終了時刻が開始時刻より早い場合は翌日の時刻として表示します。</p>
                  <div>
                    <label htmlFor="activity-notes" className="mb-1 block text-sm text-slate-300">備考・連絡事項</label>
                    <textarea id="activity-notes" rows={3} value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-800 p-3 text-white" />
                  </div>
                  <button type="button" onClick={() => void saveActivityDetails()} disabled={saving}
                    className="w-full rounded-lg bg-emerald-700 px-4 py-4 font-bold hover:bg-emerald-600 disabled:opacity-50">
                    {saving ? "保存中..." : "変更を保存"}
                  </button>
                </div>
              )}

              {dialogError && (
                <p role="alert" className="mt-4 rounded-lg bg-rose-950/40 p-3 text-sm text-rose-300">{dialogError}</p>
              )}

              <div className="mt-6 flex flex-col gap-3">
                {selectedEvent ? (
                  <button
                    type="button"
                    onClick={() => cancelActivity(selectedDay)}
                    disabled={saving}
                    className="rounded-lg bg-rose-700 px-4 py-4 font-bold hover:bg-rose-600 disabled:opacity-50"
                  >
                    {saving ? "処理中..." : "この活動予定を取り消す"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => confirmActivity(selectedDay)}
                    disabled={saving}
                    className="rounded-lg bg-cyan-600 px-4 py-4 font-bold hover:bg-cyan-500 disabled:opacity-50"
                  >
                    {saving ? "保存中..." : "活動日として確定する"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  disabled={saving}
                  className="rounded-lg bg-slate-700 px-4 py-4 font-bold hover:bg-slate-600 disabled:opacity-50"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-bold">表示の見方</h2>

          <p className="mt-3 text-sm text-slate-300">
            <span className="font-bold text-emerald-400">○</span> 参加可能 ／
            <span className="font-bold text-rose-400"> ×</span> 参加不可 ／
            <span className="font-bold text-amber-400"> 未定</span> 予定未確定 ／
            <span className="text-slate-500"> —</span> 未回答
          </p>

          <p className="mt-3 text-sm text-slate-400">
            緑色は8人全員が参加可能な日、紫色は管理者が確定した活動日です。
          </p>
        </section>
      </div>
    </main>
  );
}
