"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

type ActivityEvent = {
  id: string;
  activity_date: string;
  title: string;
  start_time: string;
  end_time: string;
};

type Preparation = {
  id: string;
  activity_event_id: string;
  title: string;
  description: string | null;
  resource_url: string | null;
};

type FormValues = {
  title: string;
  description: string;
  resource_url: string;
};

const EMPTY_FORM: FormValues = { title: "", description: "", resource_url: "" };

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return `${year}年${month}月${day}日（${WEEKDAYS[weekday]}）`;
}

function formatTime(start: string, end: string) {
  const a = start.slice(0, 5);
  const b = end.slice(0, 5);
  return `${a}〜${end <= start ? "翌" : ""}${b}`;
}

function validateUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export default function PreparationsPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [preparations, setPreparations] = useState<Preparation[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) {
          throw new Error("Discordでログインしてください。");
        }

        const { data: memberData, error: memberError } = await supabase
          .from("static_members")
          .select("user_id, is_admin");
        if (memberError) throw memberError;
        const member = (memberData ?? []).find((m) => m.user_id === authData.user.id);
        let guest = false;
        if (!member) {
          const { data: guestData, error: guestError } = await supabase
            .from("static_guests")
            .select("user_id")
            .eq("user_id", authData.user.id)
            .maybeSingle();
          if (guestError) throw guestError;
          guest = Boolean(guestData);
        }
        if (!member && !guest) {
          if (active) {
            setAuthorized(false);
            setNeedsRegistration(true);
            setIsGuest(false);
            setIsAdmin(false);
            setEvents([]);
            setPreparations([]);
          }
          return;
        }

        const [eventsResult, preparationsResult] = await Promise.all([
          supabase.from("activity_events")
            .select("id, activity_date, title, start_time, end_time")
            .order("activity_date", { ascending: true }),
          supabase.from("activity_preparations")
            .select("id, activity_event_id, title, description, resource_url"),
        ]);
        if (eventsResult.error) throw eventsResult.error;
        if (preparationsResult.error) throw preparationsResult.error;
        if (!active) return;

        const loadedEvents = (eventsResult.data ?? []) as ActivityEvent[];
        setEvents(loadedEvents);
        setPreparations((preparationsResult.data ?? []) as Preparation[]);
        setIsAdmin(member?.is_admin === true);
        setIsGuest(guest);
        setNeedsRegistration(false);
        setAuthorized(true);
        setSelectedId((current) =>
          loadedEvents.some((event) => event.id === current)
            ? current
            : (loadedEvents[0]?.id ?? "")
        );
      } catch (err) {
        if (!active) return;
        setAuthorized(false);
        setIsAdmin(false);
        setIsGuest(false);
        setError(err instanceof Error ? err.message : "読み込みに失敗しました。");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadData();
    return () => { active = false; };
  }, []);

  const selectedEvent = events.find((event) => event.id === selectedId);
  const selectedPreparation = preparations.find(
    (preparation) => preparation.activity_event_id === selectedId
  );

  function selectEvent(id: string) {
    if (saving) return;
    setSelectedId(id);
    setEditing(false);
    setForm(EMPTY_FORM);
    setError("");
    setNotice("");
  }

  function startEditing() {
    if (!isAdmin || !selectedEvent) return;
    setForm({
      title: selectedPreparation?.title ?? "",
      description: selectedPreparation?.description ?? "",
      resource_url: selectedPreparation?.resource_url ?? "",
    });
    setEditing(true);
    setError("");
    setNotice("");
  }

  function cancelEditing() {
    if (saving) return;
    setEditing(false);
    setForm(EMPTY_FORM);
    setError("");
  }

  async function savePreparation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin || !selectedEvent || saving) return;

    const title = form.title.trim();
    const description = form.description.trim();
    const resourceUrl = form.resource_url.trim();

    if (!title) {
      setError("予習タイトルを入力してください。");
      return;
    }
    if (!validateUrl(resourceUrl)) {
      setError("攻略資料URLは http:// または https:// から始まる有効なURLを入力してください。");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        title,
        description: description || null,
        resource_url: resourceUrl || null,
        updated_at: new Date().toISOString(),
      };

      const result = selectedPreparation
        ? await supabase.from("activity_preparations")
            .update(payload)
            .eq("id", selectedPreparation.id)
            .select("id, activity_event_id, title, description, resource_url")
            .single()
        : await supabase.from("activity_preparations")
            .insert({ ...payload, activity_event_id: selectedEvent.id })
            .select("id, activity_event_id, title, description, resource_url")
            .single();

      if (result.error) throw result.error;
      const saved = result.data as Preparation;
      setPreparations((current) => [
        ...current.filter((item) => item.activity_event_id !== selectedEvent.id),
        saved,
      ]);
      setEditing(false);
      setNotice("予習内容を保存しました。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function deletePreparation() {
    if (!isAdmin || !selectedPreparation || saving) return;
    if (!window.confirm("この活動日の予習内容を削除しますか？ 活動予定自体は削除されません。")) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { data, error: deleteError } = await supabase
        .from("activity_preparations")
        .delete()
        .eq("id", selectedPreparation.id)
        .select("id");
      if (deleteError) throw deleteError;
      if (!data || data.length === 0) {
        throw new Error("削除対象を確認できませんでした。ページを再読み込みしてください。");
      }
      setPreparations((current) =>
        current.filter((item) => item.id !== selectedPreparation.id)
      );
      setEditing(false);
      setNotice("予習内容を削除しました。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <Link href="/" className="text-sm text-cyan-400 hover:underline">
            ← ダッシュボードに戻る
          </Link>
          <h1 className="mt-4 text-3xl font-bold">予習・攻略資料</h1>
          <p className="mt-2 text-slate-400">
            確定した活動日ごとに、予習内容と攻略資料を確認できます。
          </p>
        </header>

        {loading && (
          <p className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-cyan-400">
            データを読み込み中...
          </p>
        )}

        {error && (
          <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-rose-300">
            {error}
          </div>
        )}
        {!loading && needsRegistration && (
          <section className="rounded-xl border border-amber-800 bg-amber-950/30 p-5">
            <p className="text-amber-200">固定メンバーまたはゲストとしての登録が必要です。</p>
            <Link href="/profile" className="mt-3 inline-block font-bold text-cyan-400 underline hover:text-cyan-300">
              プロフィールから登録する →
            </Link>
          </section>
        )}
        {!loading && authorized && isGuest && (
          <p className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
            ゲストとして閲覧中です。予習・攻略資料の登録、編集、削除はできません。
          </p>
        )}
        {notice && (
          <div role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-4 text-emerald-300">
            {notice}
          </div>
        )}

        {!loading && authorized && events.length === 0 && (
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-bold">確定済みの活動日がありません</h2>
            <p className="mt-3 text-slate-300">
              {isAdmin
                ? "先に回答一覧ページで活動日を確定してください。"
                : "管理者が活動日を確定すると、ここに予習・攻略資料が表示されます。"}
            </p>
            <Link href="/schedule/overview" className="mt-4 inline-block text-cyan-400 hover:underline">
              メンバー回答一覧へ →
            </Link>
          </section>
        )}

        {!loading && authorized && events.length > 0 && (
          <>
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <label htmlFor="activity-select" className="block text-sm font-bold text-slate-300">
                対象の活動日
              </label>
              <select
                id="activity-select"
                value={selectedId}
                onChange={(event) => selectEvent(event.target.value)}
                disabled={saving}
                className="mt-3 w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-white outline-none focus:border-cyan-400 disabled:opacity-50"
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {formatDate(event.activity_date)}｜{event.title}
                  </option>
                ))}
              </select>
              {selectedEvent && (
                <p className="mt-3 text-sm text-slate-400">
                  活動時間：{formatTime(selectedEvent.start_time, selectedEvent.end_time)}
                </p>
              )}
            </section>

            {selectedEvent && (
              <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 md:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold">この活動日の予習内容</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      {formatDate(selectedEvent.activity_date)}
                    </p>
                  </div>
                  {isAdmin && !editing && (
                    <button
                      type="button"
                      onClick={startEditing}
                      className="rounded-lg bg-cyan-700 px-4 py-3 font-bold hover:bg-cyan-600"
                    >
                      {selectedPreparation ? "予習内容を編集" : "予習内容を登録"}
                    </button>
                  )}
                </div>

                {editing && isAdmin ? (
                  <form onSubmit={savePreparation} className="mt-6 space-y-5">
                    <div>
                      <label htmlFor="preparation-title" className="block text-sm font-bold text-slate-300">
                        予習タイトル（必須）
                      </label>
                      <input
                        id="preparation-title"
                        type="text"
                        required
                        maxLength={200}
                        value={form.title}
                        onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                        placeholder="例：P3〜P4 ギミック予習"
                        disabled={saving}
                        className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-white outline-none focus:border-cyan-400 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label htmlFor="preparation-description" className="block text-sm font-bold text-slate-300">
                        予習内容・連絡事項
                      </label>
                      <textarea
                        id="preparation-description"
                        rows={6}
                        value={form.description}
                        onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                        placeholder="例：P3の復習とP4の散開位置を確認してください。"
                        disabled={saving}
                        className="mt-2 w-full resize-y rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-white outline-none focus:border-cyan-400 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label htmlFor="preparation-url" className="block text-sm font-bold text-slate-300">
                        攻略資料URL（任意）
                      </label>
                      <input
                        id="preparation-url"
                        type="url"
                        value={form.resource_url}
                        onChange={(event) => setForm((prev) => ({ ...prev, resource_url: event.target.value }))}
                        placeholder="https://example.com/guide"
                        disabled={saving}
                        className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-white outline-none focus:border-cyan-400 disabled:opacity-50"
                      />
                      <p className="mt-2 text-xs text-slate-400">
                        YouTube・Googleドキュメント・攻略サイトなどのURLを登録できます。
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-lg bg-cyan-600 px-6 py-3 font-bold hover:bg-cyan-500 disabled:opacity-50"
                      >
                        {saving ? "保存中..." : "変更を保存"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={saving}
                        className="rounded-lg bg-slate-700 px-6 py-3 font-bold hover:bg-slate-600 disabled:opacity-50"
                      >
                        キャンセル
                      </button>
                    </div>
                  </form>
                ) : selectedPreparation ? (
                  <div className="mt-6 space-y-5">
                    <div>
                      <p className="text-sm text-slate-400">予習タイトル</p>
                      <h3 className="mt-2 text-2xl font-bold text-white">
                        {selectedPreparation.title}
                      </h3>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">予習内容・連絡事項</p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-slate-200">
                        {selectedPreparation.description || "内容は登録されていません。"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">攻略資料</p>
                      {selectedPreparation.resource_url ? (
                        <a
                          href={selectedPreparation.resource_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block break-all text-cyan-400 underline hover:text-cyan-300"
                        >
                          攻略資料を開く ↗
                        </a>
                      ) : (
                        <p className="mt-2 text-slate-300">URLは未登録です。</p>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="border-t border-slate-700 pt-5">
                        <button
                          type="button"
                          onClick={deletePreparation}
                          disabled={saving}
                          className="rounded-lg border border-rose-700 px-4 py-3 font-bold text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
                        >
                          {saving ? "処理中..." : "この予習内容を削除"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-6 rounded-lg bg-slate-800 p-5 text-slate-300">
                    この活動日の予習内容はまだ登録されていません。
                  </div>
                )}
              </section>
            )}
          </>
        )}

        <footer className="pt-4 text-center text-sm text-slate-500">
          FF14 Static Manager — Development Version
        </footer>
      </div>
    </main>
  );
}
