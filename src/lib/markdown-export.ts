import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { notes, topics } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { renderNoteMarkdown, sanitizeEntryName } from "@/lib/export";

function exportRoot(): string {
  return process.env.NOTES_EXPORT_DIR || "./data/notes";
}

function removeById(dir: string, noteId: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) removeById(full, noteId);
    else if (entry.isFile() && entry.name.endsWith(`-${noteId}.md`)) fs.rmSync(full, { force: true });
  }
}

export function exportNoteMarkdown(db: DB, noteId: string): void {
  const row = db.select({ note: notes, topicName: topics.name }).from(notes).innerJoin(topics, eq(notes.topicId, topics.id)).where(and(eq(notes.id, noteId), isNull(notes.deletedAt))).get();
  const root = exportRoot();
  removeById(root, noteId);
  if (!row) return;
  const tagNames = [...(getTagsForNotes(db, [noteId]).get(noteId) ?? [])].sort();
  const topicDir = sanitizeEntryName(row.topicName, "未命名主题");
  const fileName = `${sanitizeEntryName(row.note.title, "无标题")}-${row.note.id}.md`;
  const targetDir = path.join(root, topicDir);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, fileName), renderNoteMarkdown(row.note, row.topicName, tagNames), "utf8");
}

export function scheduleNoteMarkdownExport(db: DB, noteId: string): void {
  setImmediate(() => {
    try { exportNoteMarkdown(db, noteId); }
    catch (error) { console.warn("[markdown-export] 笔记导出失败:", error instanceof Error ? error.message : error); }
  });
}
