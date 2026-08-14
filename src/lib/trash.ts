import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { aiJobs, conversations, images, notes, topics } from "@/db/schema";
import { extractImageFilenames } from "@/lib/image-refs";
import { enqueueNoteProcess } from "@/lib/notes";
import { refreshNoteFts, removeNoteFts } from "@/lib/search";

export const TRASH_RETENTION_DAYS = 30;
// 孤儿图片判定的上传宽限期：图片先入库、正文防抖保存在后，
// 没有宽限期会误删「正在编辑还没保存」的笔记里的图
export const ORPHAN_IMAGE_GRACE_MS = 24 * 3600 * 1000;

// 移入回收站：置位 deleted_at（不动 updatedAt，保持真实编辑时间）、
// 移出 FTS、删除该笔记的 AI 任务（与旧物理删除语义一致）；已在回收站的跳过
export function trashNotes(db: DB, noteIds: string[]): number {
  if (noteIds.length === 0) return 0;
  const ids = db
    .select({ id: notes.id })
    .from(notes)
    .where(and(inArray(notes.id, noteIds), isNull(notes.deletedAt)))
    .all()
    .map((r) => r.id);
  if (ids.length === 0) return 0;
  db.transaction((tx) => {
    tx.update(notes).set({ deletedAt: Date.now() }).where(inArray(notes.id, ids)).run();
    tx.delete(aiJobs).where(inArray(aiJobs.noteId, ids)).run();
    for (const id of ids) removeNoteFts(id);
  });
  return ids.length;
}

// 恢复：清 deleted_at 后重建 FTS（refreshNoteFts 只认未删除笔记，顺序不可反）；
// 被打断的 AI 处理（pending/processing）重置并重新入队，回到删除前的轨道
export function restoreNotes(db: DB, noteIds: string[]): number {
  if (noteIds.length === 0) return 0;
  const rows = db
    .select()
    .from(notes)
    .where(and(inArray(notes.id, noteIds), isNotNull(notes.deletedAt)))
    .all();
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  const interrupted = rows.filter((r) => r.aiStatus === "pending" || r.aiStatus === "processing");
  db.transaction((tx) => {
    tx.update(notes).set({ deletedAt: null }).where(inArray(notes.id, ids)).run();
    if (interrupted.length > 0) {
      tx.update(notes)
        .set({ aiStatus: "pending" })
        .where(inArray(notes.id, interrupted.map((r) => r.id)))
        .run();
    }
  });
  for (const id of ids) refreshNoteFts(db, id);
  for (const r of interrupted) enqueueNoteProcess(db, r.id);
  return ids.length;
}

// 仅物理删除笔记本体及直接关联（不做孤儿扫描），供 purgeNotes / sweepTrash 复用
function purgeNoteRows(db: DB, ids: string[]): void {
  db.transaction((tx) => {
    tx.delete(notes).where(inArray(notes.id, ids)).run(); // note_tags 靠外键级联
    tx.delete(aiJobs).where(inArray(aiJobs.noteId, ids)).run();
    tx.delete(conversations)
      .where(and(eq(conversations.scopeType, "note"), inArray(conversations.scopeId, ids)))
      .run(); // messages 靠外键级联
    for (const id of ids) removeNoteFts(id);
  });
}

// 彻底删除：只接受回收站内的笔记（防 API 被直调物理删正常笔记），随后全局清孤儿
export function purgeNotes(db: DB, noteIds: string[]): number {
  if (noteIds.length === 0) return 0;
  const ids = db
    .select({ id: notes.id })
    .from(notes)
    .where(and(inArray(notes.id, noteIds), isNotNull(notes.deletedAt)))
    .all()
    .map((r) => r.id);
  if (ids.length === 0) return 0;
  purgeNoteRows(db, ids);
  purgeOrphans(db);
  return ids.length;
}

// 全局孤儿扫描（顺路还清旧版物理删除欠下的历史孤儿）：
// - 图片：不被任何笔记（含回收站——可恢复的引用绝不能删）正文引用、且过了上传宽限期
//   → 删记录 + 删文件；文件缺失时删记录不报错
// - 会话：scope 指向已不存在的笔记/主题 → 删（消息级联）；全局会话没有 scope 对象，永不删
export function purgeOrphans(db: DB): { images: number; conversations: number } {
  const wanted = new Set<string>();
  for (const row of db.select({ content: notes.content }).from(notes).all()) {
    for (const f of extractImageFilenames(row.content)) wanted.add(path.basename(f));
  }
  const uploadDir = process.env.UPLOAD_DIR || "./data/uploads";
  const cutoff = Date.now() - ORPHAN_IMAGE_GRACE_MS;
  let removedImages = 0;
  for (const img of db.select().from(images).all()) {
    if (wanted.has(img.filename) || img.createdAt >= cutoff) continue;
    db.delete(images).where(eq(images.id, img.id)).run();
    try {
      fs.unlinkSync(path.join(uploadDir, img.filename));
    } catch {
      // 文件已不存在，只清记录
    }
    removedImages++;
  }

  const noteIds = new Set(db.select({ id: notes.id }).from(notes).all().map((r) => r.id));
  const topicIds = new Set(db.select({ id: topics.id }).from(topics).all().map((r) => r.id));
  let removedConversations = 0;
  for (const c of db
    .select({ id: conversations.id, scopeType: conversations.scopeType, scopeId: conversations.scopeId })
    .from(conversations)
    .all()) {
    /* 全局会话必须单独放行：它的 scopeId 是空串，落到 note/topic 任一分支都查不到对象，
       会被判成孤儿——每天清扫一次，用户的全部助手会话连同撤销载荷就没了。
       （注释别以 global 开头，那是 ESLint 的全局变量声明指令） */
    const alive =
      c.scopeType === "global"
        ? true
        : c.scopeType === "note"
          ? noteIds.has(c.scopeId)
          : topicIds.has(c.scopeId);
    if (alive) continue;
    db.delete(conversations).where(eq(conversations.id, c.id)).run();
    removedConversations++;
  }
  return { images: removedImages, conversations: removedConversations };
}

// 每日清扫：彻底删除满 30 天的回收站笔记 + 一轮全局孤儿扫描。
// 只在每日备份成功后被调用（先备份后销毁，见 backup.ts）
export function sweepTrash(db: DB): { purged: number; images: number; conversations: number } {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 3600 * 1000;
  const expired = db
    .select({ id: notes.id })
    .from(notes)
    .where(and(isNotNull(notes.deletedAt), lte(notes.deletedAt, cutoff)))
    .all()
    .map((r) => r.id);
  if (expired.length > 0) purgeNoteRows(db, expired);
  const orphans = purgeOrphans(db);
  return { purged: expired.length, ...orphans };
}

export function getTrashCount(db: DB): number {
  return (
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(notes)
      .where(isNotNull(notes.deletedAt))
      .get()?.c ?? 0
  );
}
