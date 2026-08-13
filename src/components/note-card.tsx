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
    <span className="rounded-full bg-fill px-2.5 py-0.5 text-[12px] text-ink-48">{name}</span>
  );
}

/* 无边框白卡：底色差即分隔，hover 浮现发丝线，active 轻缩（Apple 卡片语法）
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
      className="block rounded-[18px] bg-surface p-6 ring-hairline transition-[box-shadow,transform] hover:ring-1 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.374px]">
          {noteDisplayTitle(note)}
        </p>
        <span className="shrink-0 text-[14px] text-ink-48">{formatTime(note.updatedAt)}</span>
        {action}
      </div>
      {preview && <p className="mt-1 line-clamp-2 text-[14px] leading-[1.43] text-ink-48">{preview}</p>}
      {(tags.length > 0 || status) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {status && (
            <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${status.cls}`}>
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
    <div className="rounded-[18px] bg-surface p-10 text-center text-[14px] text-ink-48">
      {hint}
    </div>
  );
}
