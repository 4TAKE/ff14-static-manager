
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadUser() {
      const supabase = createClient();

      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.replace("/login");
        return;
      }

      setUser(data.user);
      setLoading(false);
    }

    loadUser();
  }, [router]);

  async function handleLogout() {
    const supabase = createClient();

    const { error } = await supabase.auth.signOut();

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-white">
        ログイン情報を確認しています...
      </main>
    );
  }

  const discord = user?.identities?.find(
    (identity) => identity.provider === "discord"
  );

  const metadata = discord?.identity_data ?? user?.user_metadata ?? {};

  const username =
    metadata.full_name ??
    metadata.name ??
    metadata.user_name ??
    "名前未設定";

  const avatar = metadata.avatar_url;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
        <h1 className="text-2xl font-bold">
          マイプロフィール
        </h1>

        {avatar && (
          <img
            src={avatar}
            alt="Discordアイコン"
            className="mx-auto mt-6 h-24 w-24 rounded-full"
          />
        )}

        <h2 className="mt-4 text-xl font-bold">
          {username}
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Discordアカウントでログイン中
        </p>

        <a
          href="/"
          className="mt-8 block text-cyan-400 hover:underline"
        >
          ダッシュボードへ戻る
        </a>

        {errorMessage && (
          <p className="mt-4 text-sm text-red-400">
            {errorMessage}
          </p>
        )}

        <button
          onClick={handleLogout}
          className="mt-6 w-full rounded-lg bg-red-600 px-5 py-3 font-bold hover:bg-red-500"
        >
          ログアウト
        </button>
      </div>
    </main>
  );
}
