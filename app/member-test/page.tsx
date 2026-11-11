
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type StaticMember = {
  role: string;
  display_name: string;
  is_admin: boolean;
};

export default function MemberTestPage() {
  const [members, setMembers] = useState<StaticMember[]>([]);
  const [message, setMessage] = useState(
    "まだテストを実行していません。"
  );
  const [loading, setLoading] = useState(false);

  async function runTest() {
    setLoading(true);
    setMembers([]);
    setMessage("確認中...");

    try {
      const supabase = createClient();

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        setMessage("ログインしていません。");
        return;
      }

      const { data, error } = await supabase
        .from("static_members")
        .select("role, display_name, is_admin")
        .order("role");

      if (error) {
        setMessage("取得エラー: " + error.message);
        return;
      }

      setMembers(data ?? []);
      setMessage(
        `${data?.length ?? 0}人のメンバーを取得しました。`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "予期しないエラーが発生しました。"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-white">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-2xl font-bold">
          固定メンバー取得テスト
        </h1>

        <p className="mb-6 text-slate-400">
          Discordログイン中の権限でデータを取得します。
        </p>

        <button
          onClick={runTest}
          disabled={loading}
          className="rounded-lg bg-cyan-600 px-5 py-3 font-bold disabled:opacity-50"
        >
          {loading ? "確認中..." : "メンバー取得テストを実行"}
        </button>

        <p className="my-6 text-cyan-400">{message}</p>

        <div className="space-y-3">
          {members.map((member) => (
            <div
              key={member.role}
              className="flex items-center justify-between rounded-lg bg-slate-900 p-4"
            >
              <div>
                <p className="font-bold">{member.role}</p>
                <p className="text-sm text-slate-400">
                  {member.display_name}
                </p>
              </div>

              <span
                className={
                  member.is_admin
                    ? "text-amber-400"
                    : "text-slate-400"
                }
              >
                {member.is_admin ? "管理者" : "一般メンバー"}
              </span>
            </div>
          ))}
        </div>

        <a
          href="/"
          className="mt-8 block text-cyan-400"
        >
          ← ダッシュボードに戻る
        </a>
      </div>
    </main>
  );
}
