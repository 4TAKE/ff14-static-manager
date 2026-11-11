
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

const ROLES = ["MT", "ST", "H1", "H2", "D1", "D2", "D3", "D4"] as const;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

type Answer = "○" | "×" | "未定";
type Answers = Record<string, Answer>;

type StaticMember = {
  id: string;
  role: string;
  display_name: string;
  user_id: string | null;
  is_admin: boolean;
};

type ScheduleAnswer = {
  member_id: string;
  activity_date: string;
  answer: Answer;
};

function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function answerColor(answer?: Answer) {
  if (answer === "○") return "text-emerald-400";
  if (answer === "×") return "text-rose-400";
  if (answer === "未定") return "text-amber-400";
  return "text-slate-500";
}

export default function SchedulePage() {
const [month, setMonth] = useState(new Date(2026, 0, 1));
useEffect(() => {
  const now = new Date();
  setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
}, []);
  const [members, setMembers] = useState<StaticMember[]>([]);
  const [myMember, setMyMember] = useState<StaticMember | null>(null);
  const [accessType, setAccessType] = useState<"member" | "guest" | "unregistered" | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [selectedRole, setSelectedRole] = useState("MT");
  const [answers, setAnswers] = useState<Answers>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [draftAnswer, setDraftAnswer] = useState<Answer>("○");

  // 古い月の通信結果が新しい月に反映されるのを防ぐ
  const requestId = useRef(0);

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstDay = new Date(year, monthIndex, 1).getDay();

  const isAdmin = myMember?.is_admin === true;
  const canEdit = accessType === "member" && (isAdmin || myMember?.role === selectedRole);

  const getKey = (day: number, role: string) =>
    `${formatDate(year, monthIndex, day)}-${role}`;

  const getSummary = (day: number) => {
    const values = ROLES.map((role) => answers[getKey(day, role)]);
    const yes = values.filter((v) => v === "○").length;
    const no = values.filter((v) => v === "×").length;
    const pending = values.filter((v) => v === "未定").length;
    return {
      yes,
      no,
      pending,
      unanswered: ROLES.length - yes - no - pending,
      allYes: yes === ROLES.length,
    };
  };

  // Discord認証と固定メンバーの取得
  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser();

        if (authError || !authData.user) {
          throw new Error("ログインが必要です。先にDiscordでログインしてください。");
        }

        const { data, error: memberError } = await supabase
          .from("static_members")
          .select("id, role, display_name, user_id, is_admin");

        if (memberError) throw memberError;

        const list = (data ?? []) as StaticMember[];
        const mine = list.find(
          (member) => member.user_id === authData.user.id
        );

        if (!active) return;

        if (mine) {
          setMembers(list);
          setMyMember(mine);
          setSelectedRole(mine.role);
          setAccessType("member");
          setAuthReady(true);
          return;
        }

        const { data: guestData, error: guestError } = await supabase
          .from("static_guests")
          .select("user_id")
          .eq("user_id", authData.user.id)
          .maybeSingle();

        if (guestError) throw guestError;
        if (!active) return;

        setMyMember(null);
        setMembers(list);
        setAccessType(guestData ? "guest" : "unregistered");
        setAuthReady(true);
        if (!guestData) setLoading(false);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "認証に失敗しました。"
          );
          setLoading(false);
          setAuthReady(false);
        }
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, []);

  // 月ごとの回答を取得
  const loadAnswers = useCallback(async () => {
    if (!authReady || accessType === "unregistered") return;

    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    setAnswers({});

    try {
      const start = formatDate(year, monthIndex, 1);
      const end = formatDate(year, monthIndex, daysInMonth);

      const { data, error: fetchError } = await supabase
        .from("schedule_answers")
        .select("member_id, activity_date, answer")
        .gte("activity_date", start)
        .lte("activity_date", end);

      if (fetchError) throw fetchError;

      if (currentRequest !== requestId.current) return;

      const next: Answers = {};

      for (const item of (data ?? []) as ScheduleAnswer[]) {
        const member = members.find((m) => m.id === item.member_id);
        if (member) {
          next[`${item.activity_date}-${member.role}`] = item.answer;
        }
      }

      setAnswers(next);
    } catch (err) {
      if (currentRequest === requestId.current) {
        setError(
          err instanceof Error ? err.message : "回答の取得に失敗しました。"
        );
      }
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
      }
    }
  }, [authReady, accessType, members, year, monthIndex, daysInMonth]);

  useEffect(() => {
    if (!authReady || accessType === "unregistered") return;

    void loadAnswers();

    return () => {
      requestId.current++;
    };
  }, [authReady, accessType, loadAnswers]);

  function changeMonth(offset: number) {
    if (saving) return;

    setSelectedDay(null);
    setNotice("");
    setMonth(new Date(year, monthIndex + offset, 1));
  }

  function openEditor(day: number) {
    if (!canEdit || loading || saving) return;

    const current = answers[getKey(day, selectedRole)];
    setDraftAnswer(current ?? "○");
    setSelectedDay(day);
    setNotice("");
  }

  async function saveAnswer() {
    if (selectedDay === null || !canEdit || saving || loading) return;

    const target = members.find((m) => m.role === selectedRole);
    if (!target) {
      setError("対象メンバーが見つかりません。");
      return;
    }

    const date = formatDate(year, monthIndex, selectedDay);
    const key = getKey(selectedDay, selectedRole);

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const { error: saveError } = await supabase
        .from("schedule_answers")
        .upsert(
          {
            member_id: target.id,
            activity_date: date,
            answer: draftAnswer,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "member_id,activity_date" }
        );

      if (saveError) throw saveError;

      setAnswers((prev) => ({ ...prev, [key]: draftAnswer }));
      setSelectedDay(null);
      setNotice(`${monthIndex + 1}月${selectedDay}日の回答を保存しました。`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "保存に失敗しました。"
      );
    } finally {
      setSaving(false);
    }
  }

  function DayCard({ day, mobile = false }: {
    day: number;
    mobile?: boolean;
  }) {
    const weekday = new Date(year, monthIndex, day).getDay();
    const answer = answers[getKey(day, selectedRole)];
    const summary = getSummary(day);

    const background =
      weekday === 0
        ? "bg-rose-950/40"
        : weekday === 6
          ? "bg-blue-950/40"
          : "bg-slate-800";

    return (
      <button
        type="button"
        onClick={() => openEditor(day)}
        disabled={!canEdit || loading || saving}
        className={`w-full rounded-xl border p-3 text-center transition
          ${background}
          ${summary.allYes ? "border-emerald-400" : "border-slate-700"}
          enabled:hover:border-cyan-400
          disabled:cursor-not-allowed disabled:opacity-60
          ${mobile ? "flex min-h-24 items-center justify-between px-5" : "min-h-32"}
        `}
      >
        {mobile ? (
          <>
            <div className="text-left">
              <div className="text-xl font-bold">
                {monthIndex + 1}/{day}
                <span className="ml-2 text-base text-slate-300">
                  （{WEEKDAYS[weekday]}）
                </span>
              </div>
              <div className="mt-2 text-sm text-slate-400">
                参加可能 {summary.yes}/8人
              </div>
            </div>
            <span className={`text-4xl font-bold ${answerColor(answer)}`}>
              {answer ?? "—"}
            </span>
          </>
        ) : (
          <>
            <div className="text-xl font-bold">{day}</div>
            <div className={`my-3 text-3xl font-bold ${answerColor(answer)}`}>
              {answer ?? "—"}
            </div>
            <div className="text-sm text-slate-400">
              {summary.yes}/8人
            </div>
          </>
        )}
      </button>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        
<header>
  <a
    href="/"
    className="text-sm text-cyan-400 hover:underline"
  >
    ← ダッシュボードに戻る
  </a>

  <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h1 className="text-3xl font-bold">日程調整</h1>
      <p className="mt-2 text-slate-400">
        全曜日を対象に、固定メンバーの参加可能日を調整します。
      </p>
    </div>

    <a
      href="/schedule/overview"
      className="inline-flex min-h-12 items-center justify-center rounded-xl bg-cyan-600 px-5 py-3 text-center font-bold text-white transition hover:bg-cyan-500"
    >
      メンバー回答一覧を見る →
    </a>
  </div>
</header>
        {accessType === "unregistered" && (
          <section className="rounded-xl border border-amber-700 bg-amber-950/30 p-5">
            <h2 className="text-lg font-bold text-amber-200">初回登録が必要です</h2>
            <p className="mt-2 text-sm text-slate-300">プロフィール画面から担当ポジション、またはゲストを選択してください。</p>
            <Link href="/profile" className="mt-4 inline-block rounded-lg bg-cyan-600 px-4 py-3 font-bold hover:bg-cyan-500">プロフィールで登録する →</Link>
          </section>
        )}

        {authReady && accessType !== "unregistered" && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-sm text-slate-400">{accessType === "guest" ? "閲覧中のアカウント" : "ログイン中のメンバー"}</p>

          <div className="mt-2 flex items-center gap-3">
            <span className="text-xl font-bold">
              {accessType === "guest" ? "ゲスト" : myMember?.display_name ?? "確認中"}
            </span>
            {isAdmin && (
              <span className="rounded-lg bg-amber-500/20 px-3 py-1 text-sm text-amber-300">
                管理者
              </span>
            )}
          </div>

          <label
            htmlFor="member"
            className="mb-2 mt-5 block text-sm text-slate-400"
          >
            回答対象のメンバー
          </label>

          <select
            id="member"
            value={selectedRole}
            onChange={(e) => {
              setSelectedRole(e.target.value);
              setSelectedDay(null);
            }}
            disabled={accessType !== "guest" && (!isAdmin || saving || loading)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3 text-base disabled:opacity-60 md:w-72"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>

          <p className="mt-3 text-sm text-slate-400">
            {accessType === "guest"
              ? "ゲストは閲覧専用です。表示するポジションを切り替えられますが、回答の編集はできません。"
              : isAdmin
                ? "管理者は全員の回答を代理入力できます。"
                : "自分の回答のみ編集できます。"}
          </p>
        </section>
        )}

        {error && (
          <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-300">
            {error}
          </div>
        )}

        {notice && (
          <div role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-4 text-sm text-emerald-300">
            {notice}
          </div>
        )}

        {authReady && accessType !== "unregistered" && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-6">
          <div className="mb-6 flex items-center justify-between gap-3">
            <button
              onClick={() => changeMonth(-1)}
              disabled={saving}
              className="rounded-lg bg-slate-800 px-4 py-3 text-lg hover:bg-slate-700 disabled:opacity-50"
            >
              ←
            </button>
            <h2 className="text-center text-xl font-bold md:text-2xl">
              {year}年{monthIndex + 1}月
            </h2>
            <button
              onClick={() => changeMonth(1)}
              disabled={saving}
              className="rounded-lg bg-slate-800 px-4 py-3 text-lg hover:bg-slate-700 disabled:opacity-50"
            >
              →
            </button>
          </div>

          {loading && (
            <p className="mb-4 text-center text-cyan-400">
              データを読み込み中...
            </p>
          )}

          {/* PC・タブレット：月間カレンダー */}
          <div className="hidden grid-cols-7 gap-2 md:grid">
            {WEEKDAYS.map((day, index) => (
              <div
                key={day}
                className={`py-3 text-center text-lg font-bold ${
                  index === 0
                    ? "text-rose-400"
                    : index === 6
                      ? "text-blue-400"
                      : "text-slate-300"
                }`}
              >
                {day}
              </div>
            ))}

            {Array.from({ length: firstDay }, (_, index) => (
              <div key={`empty-${index}`} />
            ))}

            {Array.from({ length: daysInMonth }, (_, index) => (
              <DayCard key={index + 1} day={index + 1} />
            ))}
          </div>

          {/* スマートフォン：日付別リスト */}
          <div className="space-y-3 md:hidden">
            {Array.from({ length: daysInMonth }, (_, index) => (
              <DayCard key={index + 1} day={index + 1} mobile />
            ))}
          </div>
        </section>
        )}

        {/* 回答選択ダイアログ */}
        {selectedDay !== null && canEdit && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="answer-dialog-title"
              className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            >
              <h2
                id="answer-dialog-title"
                className="text-center text-2xl font-bold"
              >
                {monthIndex + 1}月{selectedDay}日の回答
              </h2>

              <p className="mt-2 text-center text-slate-400">
                {selectedRole} の参加可否を選択
              </p>

              <div className="mt-6 grid grid-cols-3 gap-2">
                {([
                  ["○", "参加可能"],
                  ["×", "参加不可"],
                  ["未定", "未定"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDraftAnswer(value)}
                    disabled={saving}
                    aria-pressed={draftAnswer === value}
                    className={`min-h-28 rounded-xl border-2 p-2 transition ${
                      draftAnswer === value
                        ? "border-cyan-400 bg-slate-700"
                        : "border-slate-700 bg-slate-800"
                    }`}
                  >
                    <div className={`text-3xl font-bold ${answerColor(value)}`}>
                      {value}
                    </div>
                    <div className="mt-2 text-xs text-slate-300 sm:text-sm">
                      {label}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-slate-700 px-3 py-4 font-bold hover:bg-slate-600 disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={saveAnswer}
                  disabled={saving}
                  className="flex-[2] rounded-lg bg-cyan-600 px-3 py-4 font-bold hover:bg-cyan-500 disabled:opacity-50"
                >
                  {saving ? "保存中..." : "この回答で確定"}
                </button>
              </div>
            </div>
          </div>
        )}

        {authReady && accessType !== "unregistered" && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-bold">{accessType === "guest" ? "閲覧方法" : "回答方法"}</h2>
          <p className="mt-3 text-sm text-slate-300">
            {accessType === "guest"
              ? "ポジションを切り替えて各メンバーの回答を確認できます。ゲストは回答を変更できません。"
              : "日付を選択し、○・×・未定から回答を選んで確定してください。"}
          </p>
          <p className="mt-2 text-sm text-slate-400">
            回答はSupabaseに保存されます。8人全員が○になると緑色の枠で強調されます。
          </p>
          <p className="mt-2 text-sm text-slate-400">
            「—」は未回答、「未定」は回答済みで予定が決まっていない状態です。
          </p>
        </section>
        )}
      </div>
    </main>
  );
}

