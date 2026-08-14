// 笔记写入的唯一入口：API 路由与 AI 助手工具共用同一套路径，
// 保证 FTS 同步、锁字段、AI 重新入队这三件事不会有人漏做。
// 单独成文件而非并入 notes.ts：notes.ts 被 search.ts 依赖，
// 反向 import refreshNoteFts 会形成循环依赖。

import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { INBOX_TOPIC_ID, notes, topics } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueueNoteProcess, replaceNoteTags } from "@/lib/notes";
import { refreshNoteFts } from "@/lib/search";

export class NoteWriteError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "bad_request",
  ) {
    super(message);
  }
}

// 新建笔记。指定主题视为用户已手动归类（锁定主题），否则进未分类等 AI 处理
export function createNote(
  db: DB,
  input: { content: string; topicId?: string | null },
): { id: string; topicId: string; createdAt: number } {
  const content = input.content.trim();
  if (!content) throw new NoteWriteError("内容不能为空", "bad_request");

  let topicId = INBOX_TOPIC_ID;
  let topicLocked = 0;
  if (input.topicId) {
    const topic = db.select().from(topics).where(eq(topics.id, input.topicId)).get();
    if (!topic) throw new NoteWriteError("主题不存在", "bad_request");
    topicId = topic.id;
    if (topic.id !== INBOX_TOPIC_ID) topicLocked = 1;
  }

  const now = Date.now();
  const id = newId();
  db.insert(notes)
    .values({
      id,
      topicId,
      title: "",
      content,
      aiStatus: "pending",
      topicLocked,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  refreshNoteFts(db, id);
  enqueueNoteProcess(db, id);
  return { id, topicId, createdAt: now };
}

export interface NotePatch {
  content?: string;
  title?: string;
  topicId?: string;
  tags?: string[];
}

/* 更新笔记。title/topicId/tags 一经显式修改即置锁，AI 后续不再覆盖——
   这条对助手同样适用：否则助手刚归好类，后台 AI 又改回去，
   在用户看来就是「助手的操作被静默吞掉了」。
   正文变更会重新入队 AI 处理，与手动编辑保持同一语义。 */
export function updateNote(db: DB, noteId: string, patch: NotePatch): { updatedAt: number } {
  const note = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
    .get();
  if (!note) throw new NoteWriteError("笔记不存在", "not_found");

  if (patch.content !== undefined && !patch.content.trim()) {
    throw new NoteWriteError("内容不能为空", "bad_request");
  }
  if (patch.topicId !== undefined) {
    const topic = db.select().from(topics).where(eq(topics.id, patch.topicId)).get();
    if (!topic) throw new NoteWriteError("主题不存在", "bad_request");
  }

  const now = Date.now();
  db.transaction((tx) => {
    const values: Partial<typeof notes.$inferInsert> = { updatedAt: now };
    if (patch.content !== undefined) values.content = patch.content;
    if (patch.title !== undefined) {
      values.title = patch.title;
      values.titleLocked = 1;
    }
    if (patch.topicId !== undefined) {
      values.topicId = patch.topicId;
      values.topicLocked = 1;
    }
    tx.update(notes).set(values).where(eq(notes.id, noteId)).run();
    if (patch.tags !== undefined) {
      replaceNoteTags(tx as never, noteId, patch.tags);
      tx.update(notes).set({ tagsLocked: 1 }).where(eq(notes.id, noteId)).run();
    }
  });
  refreshNoteFts(db, noteId);

  if (patch.content !== undefined) {
    db.update(notes).set({ aiStatus: "pending" }).where(eq(notes.id, noteId)).run();
    enqueueNoteProcess(db, noteId);
  }
  return { updatedAt: now };
}
