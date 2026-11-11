
"use client";

import { useState } from "react";
import { createClient } from "../../lib/supabase/client";

export default function ConnectionTestPage() {
  const [message, setMessage] = useState(
    "まだ接続テストを実行していません。"
  );
  const [loading, setLoading] = useState(false);

  async function testConnection() {
    setLoading(true);
    setMessage("接続を確認しています...");

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.getSession();

      if (error) {
        setMessage(`接続エラー: ${error.message}`);
      } else {
        setMessage("Supabaseとの通信に成功しました！");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `エラー: ${error.message}`
          : "不明なエラーが発生しました。"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-2xl font-bold">
          Supabase接続テスト
        </h1>

        <p className="mt-4 text-slate-300">
          {message}
        </p>

        <button
          onClick={testConnection}
          disabled={loading}
          className="mt-6 rounded-lg bg-cyan-600 px-5 py-3 font-bold hover:bg-cyan-500 disabled:opacity-50"
        >
          {loading ? "確認中..." : "接続テストを実行"}
        </button>

        <a
          href="/"
          className="mt-6 block text-sm text-cyan-400 hover:underline"
        >
          ← ダッシュボードに戻る
        </a>
      </div>
    </main>
  );
}
