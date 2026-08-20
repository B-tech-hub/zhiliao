import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { aiJobs, noteTags, tags } from "@/db/schema";
import { newId } from "@/lib/ids";

// 笔记保存后入队 AI 处理任务；同一笔记已有未完成任务时仅刷新可执行时间，避免堆积
export function enqueueNoteProcess(db: DB, noteId: string) {
  const now = Date.now();
  const existing = db
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.noteId, noteId), eq(aiJobs.type, "note_process"), inArray(aiJobs.status, ["pending", "running"])))
    .get();
  if (existing) {
    db.update(aiJobs)
      .set({ status: "pending", runAfter: now, attempts: 0, lastError: null, updatedAt: now })
      .where(eq(aiJobs.id, existing.id))
      .run();
    kickWorker();
    return;
  }
  db.insert(aiJobs)
    .values({ id: newId(), noteId, type: "note_process", status: "pending", runAfter: now, createdAt: now, updatedAt: now })
    .run();
  kickWorker();
}

export function enqueueHandwritingTranscribe(db: DB, noteId: string, filename: string, baseUpdatedAt: number) {
  const now = Date.now();
  db.insert(aiJobs).values({ id: newId(), noteId, type: "handwriting_transcribe", payload: JSON.stringify({ filename, baseUpdatedAt }), status: "pending", runAfter: now, createdAt: now, updatedAt: now }).run();
  kickWorker();
}

// 通过 globalThis 触发 worker 立即轮询，避免与 worker 模块产生循环依赖
function kickWorker() {
  (globalThis as { __kbWorkerKick?: () => void }).__kbWorkerKick?.();
}

// 全量替换某条笔记的标签（按名称，自动创建缺失的标签）
export function replaceNoteTags(db: DB, noteId: string, tagNames: string[]) {
  const cleaned = [...new Set(tagNames.map((t) => t.trim()).filter(Boolean))].slice(0, 10);
  db.delete(noteTags).where(eq(noteTags.noteId, noteId)).run();
  for (const name of cleaned) {
    let tag = db.select().from(tags).where(eq(tags.name, name)).get();
    if (!tag) {
      tag = { id: newId(), name };
      db.insert(tags).values(tag).run();
    }
    db.insert(noteTags).values({ noteId, tagId: tag.id }).run();
  }
}

// 查询多条笔记的标签，返回 noteId -> 标签名数组
export function getTagsForNotes(db: DB, noteIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (noteIds.length === 0) return map;
  const rows = db
    .select({ noteId: noteTags.noteId, name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(inArray(noteTags.noteId, noteIds))
    .all();
  for (const r of rows) {
    const list = map.get(r.noteId) ?? [];
    list.push(r.name);
    map.set(r.noteId, list);
  }
  return map;
}
