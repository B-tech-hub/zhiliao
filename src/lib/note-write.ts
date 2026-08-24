// 笔记写入的唯一入口：API 路由与 AI 助手工具共用同一套路径，
// 保证 FTS 同步、锁字段、AI 重新入队这三件事不会有人漏做。
// 单独成文件而非并入 notes.ts：notes.ts 被 search.ts 依赖，
// 反向 import refreshNoteFts 会形成循环依赖。

import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { INBOX_TOPIC_ID, notes, topics } from "@/db/schema";
import { newId } from "@/lib/ids";
import { isLlmConfigured } from "@/lib/llm";
import { enqueueNoteEmbedding, enqueueNoteProcess, replaceNoteTags, getTagsForNotes } from "@/lib/notes";
import { refreshNoteFts } from "@/lib/search";
import { scheduleNoteMarkdownExport } from "@/lib/markdown-export";
import { recordCorrection } from "@/lib/correction-learning";

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
  input: { content: string; topicId?: string | null; deferAi?: boolean },
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
  if (!input.deferAi) enqueueNoteProcess(db, id);
  /* 整理任务归档后会带着标题与摘要重新入队向量（processNote 会推进 updatedAt，
     旧向量必然失效重算）。所以只有在压根不会走整理时才在这里补一次，否则每条新笔记
     都要先用无标题正文白算一次向量，embedding 调用凭空翻倍。
     deferAi 是手写笔记，此刻正文只是一个图片链接，转写完成后才接上整理链路。 */
  if (!input.deferAi && !isLlmConfigured()) enqueueNoteEmbedding(db, id);
  scheduleNoteMarkdownExport(db, id);
  return { id, topicId, createdAt: now };
}

export interface NotePatch {
  content?: string;
  title?: string;
  topicId?: string;
  tags?: string[];
  transcriptionReviewStatus?: "unreviewed" | "reviewed" | "needs_review";
  correctionSource?: "user" | "ai" | "undo";
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
  const beforeTagsForLearning = patch.tags !== undefined ? (getTagsForNotes(db, [noteId]).get(noteId) ?? []) : [];
  db.transaction((tx) => {
    const values: Partial<typeof notes.$inferInsert> = { updatedAt: now };
    if (patch.content !== undefined) values.content = patch.content;
    if (patch.content !== undefined && note.transcriptionReviewStatus === "reviewed") values.transcriptionReviewStatus = "needs_review";
    if (patch.transcriptionReviewStatus !== undefined) values.transcriptionReviewStatus = patch.transcriptionReviewStatus;
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
    // 同 createNote：整理链路会重新入队向量，未配置文本模型时才需要自己补
    if (!isLlmConfigured()) enqueueNoteEmbedding(db, noteId);
  }
  if (patch.correctionSource !== "ai" && patch.correctionSource !== "undo") {
    if (patch.topicId !== undefined && patch.topicId !== note.topicId) recordCorrection(db, noteId, "topic", note.topicId, patch.topicId);
    if (patch.title !== undefined && patch.title !== note.title) recordCorrection(db, noteId, "title", note.title || "（空）", patch.title);
    if (patch.tags !== undefined) {
      recordCorrection(db, noteId, "tags", beforeTagsForLearning.join(","), patch.tags.join(","));
    }
  }
  scheduleNoteMarkdownExport(db, noteId);
  return { updatedAt: now };
}

export interface NoteRestore {
  content?: string;
  aiStatus?: string;
  topicId?: string;
  title?: string;
  tags?: string[];
  topicLocked?: number;
  titleLocked?: number;
  tagsLocked?: number;
}

/* 按快照回写，供助手操作的撤销使用。与 updateNote 有两处刻意的不同：
   一是不置锁——锁位由快照原样恢复，否则撤销一次就永久剥夺该字段的 AI 自动整理；
   二是正文变更不重新入队 AI——撤销是「回到原状」而非一次新编辑，
   原状此前已被处理过，再跑一遍只会白耗额度并可能改掉用户已接受的标题。 */
export function restoreNote(db: DB, noteId: string, snap: NoteRestore): boolean {
  const note = db.select().from(notes).where(eq(notes.id, noteId)).get();
  if (!note) return false;

  /* 快照里的主题可能已被用户删除。notes.topicId 有外键约束且
     foreign_keys=ON，直接写回会抛 FOREIGN KEY constraint failed，
     撤销按钮变成一个 500。此时跳过主题这一项，其余字段照常恢复——
     把笔记留在当前主题，比强行挪去「未分类」更少惊扰。 */
  let topicId = snap.topicId;
  if (topicId !== undefined) {
    const exists = db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId)).get();
    if (!exists) topicId = undefined;
  }

  db.transaction((tx) => {
    const values: Partial<typeof notes.$inferInsert> = { updatedAt: Date.now() };
    if (snap.content !== undefined) values.content = snap.content;
    if (snap.aiStatus !== undefined) values.aiStatus = snap.aiStatus;
    if (topicId !== undefined) values.topicId = topicId;
    if (snap.title !== undefined) values.title = snap.title;
    if (snap.topicLocked !== undefined) values.topicLocked = snap.topicLocked;
    if (snap.titleLocked !== undefined) values.titleLocked = snap.titleLocked;
    if (snap.tagsLocked !== undefined) values.tagsLocked = snap.tagsLocked;
    tx.update(notes).set(values).where(eq(notes.id, noteId)).run();
    if (snap.tags !== undefined) replaceNoteTags(tx as never, noteId, snap.tags);
  });
  refreshNoteFts(db, noteId);
  if (snap.content !== undefined) enqueueNoteEmbedding(db, noteId);
  return true;
}
