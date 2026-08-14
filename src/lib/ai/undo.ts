// 助手操作的反向执行。每张操作卡片对应一次可撤销的写入。
//
// 判据不是 notes.updatedAt 而是状态指纹——后台 AI 处理完成时会自行刷新
// updatedAt（见 process-note.ts），而 create_note / append_to_note 都会重新
// 入队 AI，用 updatedAt 做乐观锁会让新建的笔记在几秒后就再也撤销不了。

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { notes } from "@/db/schema";
import { fingerprint, metaFingerprint, type UndoPayload } from "@/lib/ai/tools";
import { getTagsForNotes } from "@/lib/notes";
import { restoreNote } from "@/lib/note-write";
import { restoreNotes, trashNotes } from "@/lib/trash";

export interface UndoResult {
  ok: boolean;
  reason?: string;
}

const CHANGED = "笔记已被修改，无法自动撤销";
const GONE = "笔记已不存在，无法撤销";

// 按工具算出笔记「此刻」的指纹，与助手写入时的指纹比对
function currentFingerprint(db: DB, tool: string, noteId: string): string | null {
  const note = db.select().from(notes).where(eq(notes.id, noteId)).get();
  if (!note) return null;
  if (tool === "update_meta") {
    const tags = getTagsForNotes(db, [noteId]).get(noteId) ?? [];
    return metaFingerprint(note.topicId, note.title, tags);
  }
  return fingerprint(note.content);
}

export function undoToolAction(db: DB, payload: UndoPayload): UndoResult {
  try {
    return runUndo(db, payload);
  } catch (e) {
    // 撤销是用户点按钮触发的，任何未预期的数据库异常都不该变成 500。
    // 反向操作都在事务里，抛出即已回滚，数据不会停在半路
    console.error("[undo] 反向执行失败", e);
    return { ok: false, reason: "撤销失败，笔记未被改动" };
  }
}

function runUndo(db: DB, payload: UndoPayload): UndoResult {
  const { tool, noteId } = payload;

  if (payload.afterFingerprint) {
    const now = currentFingerprint(db, tool, noteId);
    if (now === null) return { ok: false, reason: GONE };
    if (now !== payload.afterFingerprint) return { ok: false, reason: CHANGED };
  }

  switch (tool) {
    case "create_note": {
      // 已经在回收站里就当作已撤销：重复点击不该报错
      const live = db
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
        .get();
      if (!live) return { ok: true };
      return trashNotes(db, [noteId]) > 0 ? { ok: true } : { ok: false, reason: GONE };
    }

    case "delete_note": {
      const trashed = db
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, noteId), isNotNull(notes.deletedAt)))
        .get();
      // 已被用户从回收站手动恢复，结果一致，视为成功
      if (!trashed) {
        const exists = db.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId)).get();
        return exists ? { ok: true } : { ok: false, reason: "笔记已被彻底删除，无法恢复" };
      }
      return restoreNotes(db, [noteId]) > 0 ? { ok: true } : { ok: false, reason: GONE };
    }

    case "append_to_note": {
      const len = payload.before.contentLength;
      if (typeof len !== "number") return { ok: false, reason: "撤销信息不完整" };
      const note = db.select().from(notes).where(eq(notes.id, noteId)).get();
      if (!note) return { ok: false, reason: GONE };
      const aiStatus = typeof payload.before.aiStatus === "string" ? payload.before.aiStatus : undefined;
      return restoreNote(db, noteId, { content: note.content.slice(0, len), aiStatus })
        ? { ok: true }
        : { ok: false, reason: GONE };
    }

    case "update_meta": {
      const b = payload.before;
      const ok = restoreNote(db, noteId, {
        topicId: typeof b.topicId === "string" ? b.topicId : undefined,
        title: typeof b.title === "string" ? b.title : undefined,
        tags: Array.isArray(b.tags) ? (b.tags as string[]) : undefined,
        // 锁位随值一起恢复：只恢复值不恢复锁，笔记会永久失去 AI 自动整理
        topicLocked: typeof b.topicLocked === "number" ? b.topicLocked : undefined,
        titleLocked: typeof b.titleLocked === "number" ? b.titleLocked : undefined,
        tagsLocked: typeof b.tagsLocked === "number" ? b.tagsLocked : undefined,
      });
      return ok ? { ok: true } : { ok: false, reason: GONE };
    }

    default:
      return { ok: false, reason: `不支持撤销 ${tool} 操作` };
  }
}
