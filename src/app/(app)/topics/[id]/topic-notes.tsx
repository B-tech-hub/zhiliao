"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Note } from "@/db/schema";
import { NoteCard, noteDisplayTitle } from "@/components/note-card";
import { ConfirmDialog } from "@/components/confirm-dialog";

type TopicNote = Note & { tags: string[] };

// 主题页笔记列表：卡片右上角快捷删除（常显小按钮，兼容移动端无 hover）
export function TopicNotes({ notes }: { notes: TopicNote[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<TopicNote | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${pending.id}`, { method: "DELETE" });
      if (res.ok) {
        setPending(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {notes.map((n) => (
        <NoteCard
          key={n.id}
          note={n}
          tags={n.tags}
          action={
            <button
              aria-label="删除笔记"
              onClick={(e) => {
                // 按钮位于 Link 内部，需阻止导航与冒泡
                e.preventDefault();
                e.stopPropagation();
                setPending(n);
              }}
              className="-m-2 shrink-0 rounded-full p-2 text-ink-48 transition-colors hover:text-danger active:scale-95"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M2.5 4h11M6.5 4V2.75c0-.41.34-.75.75-.75h1.5c.41 0 .75.34.75.75V4m2.75 0-.5 9a1 1 0 0 1-1 .95h-5.5a1 1 0 0 1-1-.95l-.5-9"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          }
        />
      ))}
      <ConfirmDialog
        open={pending !== null}
        title={pending ? `删除「${noteDisplayTitle(pending)}」？` : ""}
        message="删除后不可恢复"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
