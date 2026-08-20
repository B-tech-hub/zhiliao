"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* 新建主题入口。
   注意与"新笔记"区分：主题是分类容器，笔记才是内容——
   两者按钮在同一屏出现过多次，文案必须写全"新建主题"而不是简写成"新建"。 */
export function NewTopicButton({ tone = "light" }: { tone?: "light" | "dark" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setName("");
    setError("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "创建失败");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("网络错误");
    } finally {
      setBusy(false);
    }
  }

  const dark = tone === "dark";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-2 rounded-utility px-3 py-1.5 text-[14px] transition-colors ${
          dark
            ? "text-dark-muted hover:bg-white/5 hover:text-white"
            : "text-action hover:bg-fill"
        }`}
      >
        <span aria-hidden className="text-[16px] leading-none">＋</span>
        新建主题
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="px-1 py-1">
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        maxLength={30}
        placeholder="主题名，如：羽毛球"
        className={`h-[32px] w-full rounded-utility border px-3 text-[14px] outline-none ${
          dark
            ? "border-white/15 bg-white/5 text-white placeholder:text-dark-muted focus:border-sky"
            : "border-hairline bg-surface text-ink focus:border-action-focus"
        }`}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className={`rounded-utility px-3 py-1 text-[12px] transition-transform active:scale-95 disabled:opacity-40 ${
            dark ? "bg-white/15 text-white" : "bg-cta text-cta-ink"
          }`}
        >
          创建
        </button>
        <button
          type="button"
          onClick={close}
          className={`text-[12px] ${dark ? "text-dark-muted" : "text-ink-48"}`}
        >
          取消
        </button>
      </div>
      {error && (
        <p className={`mt-1.5 text-[12px] ${dark ? "text-danger" : "text-danger"}`}>{error}</p>
      )}
    </form>
  );
}
