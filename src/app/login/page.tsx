"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "登录失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6">
        <div className="mb-10 text-center">
          <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.4px]">知了</h1>
          <p className="mt-3 text-[17px] text-ink-48">随手记，AI 替你归档。</p>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入访问密码"
          autoFocus
          className="h-[44px] w-full rounded-full border border-hairline bg-surface px-5 text-[17px] outline-none focus:border-action-focus"
        />
        {error && <p className="text-center text-[14px] text-danger">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded-full bg-action px-[22px] py-[11px] text-[17px] text-white transition-transform active:scale-95 disabled:opacity-40"
        >
          {loading ? "登录中…" : "登录"}
        </button>
      </form>
    </main>
  );
}
