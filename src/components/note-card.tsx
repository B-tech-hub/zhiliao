import Link from "next/link";
import type { ReactNode } from "react";
import type { Note } from "@/db/schema";

// 笔记摘要行：优先标题，其次内容首行
export function noteDisplayTitle(note: Pick<Note, "title" | "content">): string {
  if (note.title) return note.title;
  const firstLine = note.content.split("\n").find((l) => l.trim());
  return (firstLine ?? "（空笔记）").replace(/^#+\s*/, "").slice(0, 40);
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameYear) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

const AI_STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "待整理", cls: "bg-fill text-ink-48" },
  processing: { text: "AI 整理中", cls: "bg-fill text-action" },
  failed: { text: "整理失败", cls: "bg-danger-tint text-danger" },
};

export function TagChip({ name }: { name: string }) {
  return (
    <span className="rounded-chip bg-fill px-2 py-0.5 text-micro uppercase tracking-[0.08em] text-ink-48">
      {name}
    </span>
  );
}

/* 紧凑行：用底部发丝线分隔，hover 只改变底色，避免每条笔记都变成独立卡片。
   列表页的职责是让人快速扫过并找到那一条，密度本身就是功能。
   action：右上角可选操作区（如删除按钮），由调用方自行阻止 Link 导航 */
export function NoteCard({
  note,
  tags,
  action,
}: {
  note: Note;
  tags: string[];
  action?: ReactNode;
}) {
  const status = AI_STATUS_LABEL[note.aiStatus];
  const preview = note.summary || note.content.replace(/[#*`>\-\[\]!|]/g, "").slice(0, 80);
  return (
    <Link
      href={`/notes/${note.id}`}
      className="group block border-b border-divider px-4 py-3 transition-colors hover:bg-fill active:bg-fill"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.24px]">
          {noteDisplayTitle(note)}
        </p>
        <span className="shrink-0 font-mono text-meta text-ink-48">{formatTime(note.updatedAt)}</span>
        {action}
      </div>
      {/* 摘要压到单行：两行摘要占的是「再多看一条笔记」的位置 */}
      {preview && (
        <p className="mt-0.5 truncate text-[13px] leading-[1.4] text-ink-48">{preview}</p>
      )}
      {(tags.length > 0 || status) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {status && (
            <span className={`rounded-chip px-2 py-0.5 text-micro font-semibold ${status.cls}`}>
              {status.text}
            </span>
          )}
          {tags.map((t) => (
            <TagChip key={t} name={t} />
          ))}
        </div>
      )}
    </Link>
  );
}

export function EmptyNotes({ hint }: { hint: string }) {
  return (
    <div className="rounded-card bg-surface p-10 text-center">
      <p className="font-serif text-2xl leading-tight text-ink">{hint}</p>
    </div>
  );
}
