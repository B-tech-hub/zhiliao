"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Note } from "@/db/schema";
import { EmptyNotes, TagChip, formatTime, noteDisplayTitle } from "@/components/note-card";
import { ConfirmDialog } from "@/components/confirm-dialog";

type InboxNote = Note & { tags: string[] };

interface TopicOption {
  id: string;
  name: string;
  isSystem: number;
}

interface SuggestionItem {
  name: string;
  reason: string;
  noteIds: string[];
  existingTopicId: string | null;
}

interface Suggestion {
  id: string;
  suggestions: SuggestionItem[];
}

export function InboxClient({
  notes,
  topics,
  suggestion,
}: {
  notes: InboxNote[];
  topics: TopicOption[];
  suggestion: Suggestion | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  // 批量删除确认框是否打开
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 建议卡片中被用户剔除的笔记
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const noteById = new Map(notes.map((n) => [n.id, n]));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function batchMove() {
    if (selected.size === 0 || !moveTarget) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notes/batch-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteIds: [...selected], topicId: moveTarget }),
      });
      if (res.ok) {
        setSelected(new Set());
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function batchDelete() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notes/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteIds: [...selected] }),
      });
      if (res.ok) {
        setSelected(new Set());
        setConfirmingDelete(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      await fetch("/api/suggestions/generate", { method: "POST" });
      // 聚类在后台异步执行，稍后刷新即可看到
      setTimeout(() => {
        router.refresh();
        setGenerating(false);
      }, 8000);
    } catch {
      setGenerating(false);
    }
  }

  async function accept(index: number, item: SuggestionItem) {
    if (!suggestion) return;
    const noteIds = item.noteIds.filter((id) => !excluded.has(`${index}:${id}`));
    if (noteIds.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/suggestions/${suggestion.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, noteIds }),
      });
      if (res.ok) router.refresh();
      else alert((await res.json().catch(() => ({}))).error || "采纳失败");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!suggestion) return;
    await fetch(`/api/suggestions/${suggestion.id}/dismiss`, { method: "POST" });
    router.refresh();
  }

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-4">
        <header>
          <p className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-ink-48">知了</p>
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.4px] md:text-[40px]">
            未分类
          </h1>
        </header>
        {notes.length >= 3 && (
          <button
            onClick={generate}
            disabled={generating}
            className="shrink-0 rounded-full bg-action px-4 py-1.5 text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
          >
            {generating ? "AI 分析中…" : "让 AI 帮我整理"}
          </button>
        )}
      </div>
      <p className="mb-8 text-[14px] text-ink-48">AI 拿不准归属的笔记会先留在这里</p>

      {/* AI 建议卡：近黑瓷砖（surface-tile 语法），内容区唯一暗色焦点 */}
      {suggestion && suggestion.suggestions.length > 0 && (
        <div className="mb-6 space-y-3">
          {suggestion.suggestions.map((item, index) => {
            const validNotes = item.noteIds.filter((id) => noteById.has(id));
            if (validNotes.length === 0) return null;
            return (
              <div key={index} className="rounded-[18px] bg-tile p-6">
                <p className="text-[17px] font-semibold tracking-[-0.374px] text-white">
                  {item.existingTopicId ? "建议归入现有主题" : "建议新建主题"}「{item.name}」
                </p>
                <p className="mt-1 text-[14px] text-dark-muted">{item.reason}</p>
                <ul className="mt-4 space-y-2">
                  {validNotes.map((id) => {
                    const key = `${index}:${id}`;
                    const note = noteById.get(id)!;
                    return (
                      <li key={id} className="flex items-center gap-2.5 text-[14px] text-white">
                        <input
                          type="checkbox"
                          checked={!excluded.has(key)}
                          onChange={() => {
                            const next = new Set(excluded);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            setExcluded(next);
                          }}
                          className="h-4 w-4 accent-sky"
                        />
                        <span className="truncate">{noteDisplayTitle(note)}</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-5 flex items-center gap-5">
                  <button
                    onClick={() => accept(index, item)}
                    disabled={busy}
                    className="rounded-full bg-action px-[22px] py-[8px] text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
                  >
                    采纳
                  </button>
                  <button
                    onClick={dismiss}
                    disabled={busy}
                    className="text-[14px] text-sky transition-opacity active:opacity-70 disabled:opacity-40"
                  >
                    全部忽略
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 批量移动工具条：毛玻璃悬浮（floating-sticky-bar 语法） */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mb-4 flex items-center gap-2 rounded-full border border-hairline bg-parchment/80 py-2 pl-4 pr-2 backdrop-blur-xl">
          <span className="text-[14px] text-ink-80">已选 {selected.size} 条</span>
          <select
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
            className="h-[32px] flex-1 rounded-full border border-hairline bg-surface px-3 text-[14px] outline-none"
          >
            <option value="">移动到…</option>
            {topics
              .filter((t) => !t.isSystem)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <button
            onClick={batchMove}
            disabled={busy || !moveTarget}
            className="rounded-full bg-action px-4 py-1.5 text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
          >
            移动
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            className="rounded-full bg-danger px-4 py-1.5 text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
          >
            删除
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={`把 ${selected.size} 条笔记移入回收站？`}
        message="30 天内可在 设置 → 回收站 恢复"
        confirmText="移入"
        danger={false}
        busy={busy}
        onConfirm={batchDelete}
        onCancel={() => setConfirmingDelete(false)}
      />

      {notes.length === 0 ? (
        <EmptyNotes hint="太棒了，没有待整理的笔记" />
      ) : (
        <div className="space-y-1.5">
          {notes.map((n) => (
            <div
              key={n.id}
              className="flex items-center gap-3.5 rounded-[18px] bg-surface p-5"
            >
              <input
                type="checkbox"
                checked={selected.has(n.id)}
                onChange={() => toggle(n.id)}
                className="h-4 w-4 shrink-0 accent-action"
              />
              <Link href={`/notes/${n.id}`} className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.224px]">
                    {noteDisplayTitle(n)}
                  </p>
                  <span className="shrink-0 text-[12px] text-ink-48">{formatTime(n.updatedAt)}</span>
                </div>
                {n.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {n.tags.map((t) => (
                      <TagChip key={t} name={t} />
                    ))}
                  </div>
                )}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
