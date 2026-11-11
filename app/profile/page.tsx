"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

const supabase = createClient();
const ROLES = ["MT", "ST", "H1", "H2", "D1", "D2", "D3", "D4"] as const;
type Role = (typeof ROLES)[number];
type Registration = { type: "member"; role: string } | { type: "guest" } | null;

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [registration, setRegistration] = useState<Registration>(null);
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | "">("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        router.replace("/login");
        return;
      }
      setUser(authData.user);
      const { data: members, error: membersError } = await supabase
        .from("static_members")
        .select("role")
        .eq("user_id", authData.user.id)
        .limit(1);
      if (membersError) throw membersError;
      if (members?.length) {
        setRegistration({ type: "member", role: members[0].role });
        setAvailableRoles([]);
        return;
      }
      const { data: guests, error: guestsError } = await supabase
        .from("static_guests")
        .select("user_id")
        .eq("user_id", authData.user.id)
        .limit(1);
      if (guestsError) throw guestsError;
      if (guests?.length) {
        setRegistration({ type: "guest" });
      } else {
        setRegistration(null);
      }
      const { data: roles, error: rolesError } = await supabase.rpc("list_available_static_roles");
      if (rolesError) throw rolesError;
      setAvailableRoles((roles ?? []).map((r: { role: string }) => r.role));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "プロフィールの取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  async function registerMember() {
    if (!selectedRole || !availableRoles.includes(selectedRole) || busy) return;
    setBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    const { error } = await supabase.rpc("register_static_member", { requested_role: selectedRole });
    if (error) {
      setErrorMessage(error.message);
      setBusy(false);
      await loadProfile();
      return;
    }
    setSuccessMessage(`${selectedRole}として登録しました。`);
    await loadProfile();
    setBusy(false);
    router.refresh();
  }

  async function registerGuest() {
    if (busy) return;
    setBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    const { error } = await supabase.rpc("register_static_guest");
    if (error) {
      setErrorMessage(error.message);
      setBusy(false);
      return;
    }
    setSuccessMessage("ゲストとして登録しました。");
    await loadProfile();
    setBusy(false);
    router.refresh();
  }

  async function handleLogout() {
    setBusy(true);
    setErrorMessage("");
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      setBusy(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  if (loading) {
    return <main className="min-h-screen bg-slate-950 p-8 text-white">ログイン情報を確認しています...</main>;
  }

  const discord = user?.identities?.find((identity) => identity.provider === "discord");
  const metadata = discord?.identity_data ?? user?.user_metadata ?? {};
  const username = metadata.full_name ?? metadata.name ?? metadata.user_name ?? "名前未設定";
  const avatar = metadata.avatar_url;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 text-center sm:p-8">
        <h1 className="text-2xl font-bold">マイプロフィール</h1>
        {typeof avatar === "string" && /^https:\/\//.test(avatar) && (
          // Discord OAuthから取得した画像URL
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="Discordアイコン" className="mx-auto mt-6 h-24 w-24 rounded-full" />
        )}
        <h2 className="mt-4 text-xl font-bold">{username}</h2>
        <p className="mt-2 text-sm text-slate-400">Discordアカウントでログイン中</p>

        {registration?.type === "member" && (
          <div className="mt-6 rounded-lg border border-cyan-800 bg-cyan-950/40 p-4">
            <p className="text-sm text-slate-300">固定メンバーとして登録済み</p>
            <p className="mt-1 text-2xl font-bold text-cyan-300">{registration.role}</p>
          </div>
        )}

        {registration?.type === "guest" && (
          <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="font-bold">ゲスト（閲覧専用）</p>
            <p className="mt-2 text-sm text-slate-300">活動予定・出欠一覧・予習資料を閲覧できます。</p>
          </div>
        )}

        {registration?.type !== "member" && (
          <section className="mt-6 rounded-lg border border-slate-700 bg-slate-950 p-4 text-left">
            <h3 className="font-bold">固定メンバーとして登録</h3>
            <p className="mt-2 text-sm text-slate-400">空いているポジションを選択してください。登録後はご自身で変更できません。</p>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {ROLES.map((role) => {
                const available = availableRoles.includes(role);
                return (
                  <button key={role} type="button" disabled={!available || busy}
                    onClick={() => setSelectedRole(role)}
                    className={`rounded-lg border px-2 py-3 text-sm font-bold ${selectedRole === role ? "border-cyan-400 bg-cyan-950 text-cyan-200" : "border-slate-700 bg-slate-800"} ${!available ? "cursor-not-allowed opacity-35" : "hover:border-cyan-400"}`}
                    title={available ? `${role}を選択` : `${role}は登録済み`}>{role}</button>
                );
              })}
            </div>
            <button type="button" disabled={!selectedRole || !availableRoles.includes(selectedRole) || busy}
              onClick={registerMember}
              className="mt-4 w-full rounded-lg bg-cyan-600 px-4 py-3 font-bold hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? "処理中..." : selectedRole ? `${selectedRole}で登録する` : "ポジションを選択してください"}
            </button>
          </section>
        )}

        {!registration && (
          <section className="mt-4 rounded-lg border border-slate-700 bg-slate-950 p-4 text-left">
            <h3 className="font-bold">ゲストとして利用</h3>
            <p className="mt-2 text-sm text-slate-400">ポジションを使わず、閲覧専用で利用します。</p>
            <button type="button" disabled={busy} onClick={registerGuest}
              className="mt-4 w-full rounded-lg border border-slate-500 px-4 py-3 font-bold hover:bg-slate-800 disabled:opacity-40">
              ゲストとして登録する
            </button>
          </section>
        )}

        {successMessage && <p role="status" className="mt-4 text-sm text-emerald-300">{successMessage}</p>}
        {errorMessage && <p role="alert" className="mt-4 whitespace-pre-wrap text-sm text-rose-300">{errorMessage}</p>}
        <Link href="/" className="mt-8 block text-cyan-400 hover:underline">ダッシュボードへ戻る</Link>
        <button type="button" disabled={busy} onClick={handleLogout}
          className="mt-6 w-full rounded-lg bg-red-600 px-5 py-3 font-bold hover:bg-red-500 disabled:opacity-40">ログアウト</button>
      </div>
    </main>
  );
}
