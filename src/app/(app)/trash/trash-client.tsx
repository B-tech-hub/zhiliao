"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BackButton } from "@/components/back-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyNotes, formatTime, noteDisplayTitle } from "@/components/note-card";

export interface TrashItem {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  deletedAt: number;
  remainingDays: number;
}

// 回收站列表：不提供详情跳转（已删笔记的详情页为 404），摘要信息在行内展示
export function TrashClient({ notes }: { notes: TrashItem[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // 待彻底删除的 id 集：单条与批量共用同一个确认框
  const [pendingPurge, setPendingPurge] = useState<string[] | null>(null);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function call(url: string, noteIds: string[]) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteIds }),
      });
      if (res.ok) {
        setSelected(new Set());
        setPendingPurge(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const restore = (ids: string[]) => call("/api/trash/restore", ids);

  return (
    <div>
      <BackButton fallback="/settings" className="mb-4" />
      <header className="mb-2">
        <p className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-ink-48">知了</p>
        <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.4px] md:text-[40px]">
          回收站
        </h1>
      </header>
      <p className="mb-8 text-[14px] text-ink-48">
        回收站内的笔记保留 30 天，之后随每日备份自动清除
      </p>

      {/* 批量工具条：毛玻璃悬浮（floating-sticky-bar 语法，与未分类页同款） */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mb-4 flex items-center gap-2 rounded-full border border-hairline bg-parchment/80 py-2 pl-4 pr-2 backdrop-blur-xl">
          <span className="flex-1 text-[14px] text-ink-80">已选 {selected.size} 条</span>
          <button
            onClick={() => restore([...selected])}
            disabled={busy}
            className="rounded-full bg-action px-4 py-1.5 text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
          >
            恢复
          </button>
          <button
            onClick={() => setPendingPurge([...selected])}
            disabled={busy}
            className="rounded-full bg-danger px-4 py-1.5 text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
          >
            彻底删除
          </button>
        </div>
      )}

      {notes.length === 0 ? (
        <EmptyNotes hint="回收站是空的" />
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="flex items-center gap-3.5 rounded-[18px] bg-surface p-5">
              <input
                type="checkbox"
                checked={selected.has(n.id)}
                onChange={() => toggle(n.id)}
                className="h-4 w-4 shrink-0 accent-action"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold tracking-[-0.224px]">
                  {noteDisplayTitle(n)}
                </p>
                {n.summary && <p className="mt-0.5 truncate text-[12px] text-ink-48">{n.summary}</p>}
                <p className="mt-0.5 text-[12px] text-ink-48">
                  {formatTime(n.deletedAt)} 删除 ·{" "}
                  {n.remainingDays > 0 ? `剩余 ${n.remainingDays} 天` : "即将清除"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => restore([n.id])}
                  disabled={busy}
                  className="rounded-full px-3 py-1 text-[12px] text-action transition-transform active:scale-95 disabled:opacity-40"
                >
                  恢复
                </button>
                <button
                  onClick={() => setPendingPurge([n.id])}
                  disabled={busy}
                  className="rounded-full px-3 py-1 text-[12px] text-danger transition-transform active:scale-95 disabled:opacity-40"
                >
                  彻底删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingPurge !== null}
        title={pendingPurge && pendingPurge.length > 1 ? `彻底删除 ${pendingPurge.length} 条笔记？` : "彻底删除这条笔记？"}
        message="彻底删除后无法恢复（既有备份中最多还保留 7 天），关联图片与 AI 对话一并清理"
        confirmText="彻底删除"
        busy={busy}
        onConfirm={() => pendingPurge && call("/api/trash/purge", pendingPurge)}
        onCancel={() => setPendingPurge(null)}
      />
    </div>
  );
}
