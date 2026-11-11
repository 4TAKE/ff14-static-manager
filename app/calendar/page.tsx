"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

type ActivityEvent = {
  id: string;
  activity_date: string;
  title: string;
  start_time: string;
  end_time: string;
  notes: string | null;
};

type Member = { id: string; user_id: string | null };

function dateKey(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function timeLabel(start: string, end: string) {
  const a = start.slice(0, 5);
  const b = end.slice(0, 5);
  return `${a} 〜 ${b <= a ? "翌" : ""}${b}`;
}

function formatDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];
  return `${year}年${month}月${day}日（${weekday}）`;
}

export default function ActivityCalendarPage() {
  // 初期描画をサーバーと一致させ、現在月はマウント後に設定します。
  const [month, setMonth] = useState(new Date(2026, 0, 1));
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [selected, setSelected] = useState<ActivityEvent | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [todayKey, setTodayKey] = useState("");

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstWeekday = new Date(year, monthIndex, 1).getDay();

  useEffect(() => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setTodayKey(dateKey(now.getFullYear(), now.getMonth(), now.getDate()));
    setReady(true);
  }, []);

  const load = useCallback(async (signal: { cancelled: boolean }) => {
    setLoading(true);
    setError("");
    setSelected(null);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Discordでログインしてください。");

      const { data: members, error: memberError } = await supabase
        .from("static_members")
        .select("id, user_id");
      if (memberError) throw memberError;
      const isMember = ((members ?? []) as Member[]).some(
        (member) => member.user_id === authData.user.id
      );
      if (!isMember) throw new Error("固定メンバーとして登録されていません。");

      const start = dateKey(year, monthIndex, 1);
      const end = dateKey(year, monthIndex, daysInMonth);
      const { data, error: eventError } = await supabase
        .from("activity_events")
        .select("id, activity_date, title, start_time, end_time, notes")
        .gte("activity_date", start)
        .lte("activity_date", end)
        .order("activity_date", { ascending: true });
      if (eventError) throw eventError;
      if (!signal.cancelled) {
        setAuthorized(true);
        setEvents((data ?? []) as ActivityEvent[]);
      }
    } catch (err) {
      if (!signal.cancelled) {
        setAuthorized(false);
        setEvents([]);
        setError(err instanceof Error ? err.message : "予定の読み込みに失敗しました。");
      }
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }, [year, monthIndex, daysInMonth]);

  useEffect(() => {
    if (!ready) return;
    const signal = { cancelled: false };
    void load(signal);
    return () => { signal.cancelled = true; };
  }, [ready, load]);

  function moveMonth(offset: number) {
    setSelected(null);
    setMonth(new Date(year, monthIndex + offset, 1));
  }

  function goToCurrentMonth() {
    const now = new Date();
    setTodayKey(dateKey(now.getFullYear(), now.getMonth(), now.getDate()));
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelected(null);
  }

  const eventByDate = new Map(events.map((event) => [event.activity_date, event]));
  const calendarCells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 ? day : null;
  });
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white md:px-8 md:py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/" className="text-sm text-cyan-400 hover:underline">← ダッシュボードに戻る</Link>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">活動予定カレンダー</h1>
              <p className="mt-2 text-slate-400">確定した固定活動の日程を確認できます。</p>
            </div>
            <Link href="/schedule/overview" className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-bold hover:bg-slate-700">
              日程調整・回答一覧を見る
            </Link>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 md:p-6">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => moveMonth(-1)} disabled={!ready || loading} aria-label="前月" className="rounded-lg bg-slate-800 px-4 py-3 hover:bg-slate-700 disabled:opacity-50">←</button>
            <div className="text-center">
              <h2 className="text-xl font-bold md:text-2xl">{ready ? `${year}年${monthIndex + 1}月` : "読み込み中"}</h2>
              <button type="button" onClick={goToCurrentMonth} disabled={!ready || loading} className="mt-1 text-sm text-cyan-400 hover:underline disabled:opacity-50">今月に戻る</button>
            </div>
            <button type="button" onClick={() => moveMonth(1)} disabled={!ready || loading} aria-label="翌月" className="rounded-lg bg-slate-800 px-4 py-3 hover:bg-slate-700 disabled:opacity-50">→</button>
          </div>
          {!loading && authorized && (
            <p className="mt-5 rounded-xl bg-violet-950/40 px-4 py-3 text-center text-sm text-violet-200">
              この月の確定済み活動日：<span className="text-lg font-bold">{events.length}日</span>
            </p>
          )}
        </section>

        {loading && <p className="text-center text-cyan-400">活動予定を読み込み中...</p>}
        {error && <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-rose-300">{error}</p>}

        {!loading && authorized && (
          <>
            <section className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 md:block">
              <div className="grid grid-cols-7 bg-slate-800 text-center text-sm font-bold">
                {WEEKDAYS.map((day, index) => (
                  <div key={day} className={`py-4 ${index === 0 ? "text-rose-300" : index === 6 ? "text-blue-300" : "text-slate-200"}`}>{day}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarCells.map((day, index) => {
                  const date = day === null ? "" : dateKey(year, monthIndex, day);
                  const event = eventByDate.get(date);
                  const isToday = date === todayKey;
                  const weekday = index % 7;
                  return (
                    <div key={index} className={`min-h-32 border-r border-t border-slate-800 p-2 ${day === null ? "bg-slate-950/60" : event ? "bg-violet-950/35" : weekday === 0 ? "bg-rose-950/15" : weekday === 6 ? "bg-blue-950/15" : ""}`}>
                      {day !== null && (
                        <>
                          <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${isToday ? "bg-cyan-500 text-slate-950" : weekday === 0 ? "text-rose-300" : weekday === 6 ? "text-blue-300" : "text-slate-300"}`}>{day}</div>
                          {event && (
                            <button type="button" onClick={() => setSelected(event)} className="w-full rounded-lg border border-violet-600/50 bg-violet-700/40 p-2 text-left hover:bg-violet-600/50">
                              <span className="block break-words text-xs font-bold text-violet-100">{event.title}</span>
                              <span className="mt-1 block text-xs text-violet-200">{timeLabel(event.start_time, event.end_time)}</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3 md:hidden">
              <h3 className="text-lg font-bold">今月の活動予定</h3>
              {events.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center text-slate-400">この月に確定した活動日はありません。</div>
              ) : events.map((event) => (
                <button key={event.id} type="button" onClick={() => setSelected(event)} className="w-full rounded-xl border border-violet-700/60 bg-slate-900 p-4 text-left hover:bg-slate-800">
                  <span className="block text-sm text-violet-300">{formatDate(event.activity_date)}</span>
                  <span className="mt-2 block text-lg font-bold">{event.title}</span>
                  <span className="mt-1 block text-sm text-slate-300">{timeLabel(event.start_time, event.end_time)}</span>
                  <span className="mt-3 block text-right text-sm text-cyan-400">詳細を見る →</span>
                </button>
              ))}
            </section>

            <p className="text-sm text-slate-400">紫色の予定を選択すると詳細を確認できます。予定の変更は「日程調整・回答一覧」から行ってください。</p>
          </>
        )}

        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setSelected(null)}>
            <div role="dialog" aria-modal="true" aria-labelledby="calendar-detail-title" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <p className="text-sm font-bold text-violet-300">確定済みの活動予定</p>
              <h2 id="calendar-detail-title" className="mt-2 text-2xl font-bold">{selected.title}</h2>
              <dl className="mt-5 space-y-4">
                <div><dt className="text-sm text-slate-400">活動日</dt><dd className="mt-1 font-bold">{formatDate(selected.activity_date)}</dd></div>
                <div><dt className="text-sm text-slate-400">活動時間</dt><dd className="mt-1 font-bold">{timeLabel(selected.start_time, selected.end_time)}</dd></div>
                <div><dt className="text-sm text-slate-400">備考・連絡事項</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-200">{selected.notes || "特になし"}</dd></div>
              </dl>
              <div className="mt-6 flex flex-col gap-3">
                <Link href="/preparations" className="rounded-xl bg-violet-700 px-4 py-3 text-center font-bold hover:bg-violet-600">予習・攻略資料を見る</Link>
                <button type="button" onClick={() => setSelected(null)} className="rounded-xl bg-slate-700 px-4 py-3 font-bold hover:bg-slate-600">閉じる</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
