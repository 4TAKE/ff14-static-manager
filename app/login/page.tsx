
"use client";

import { useState } from "react";
import { createClient } from "../../lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function loginWithDiscord() {
    setLoading(true);
    setErrorMessage("");

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
        <h1 className="text-2xl font-bold">
          FF14 Static Manager
        </h1>

        <p className="mt-3 text-slate-400">
          固定活動管理ツール
        </p>

        <button
          onClick={loginWithDiscord}
          disabled={loading}
          className="mt-8 w-full rounded-lg bg-indigo-600 px-6 py-3 font-bold hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? "ログイン処理中..." : "Discordでログイン"}
        </button>

        {errorMessage && (
          <p className="mt-4 text-sm text-red-400">
            {errorMessage}
          </p>
        )}
      </div>
    </main>
  );
}
