import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { aiJobs, conversations, images, messages, notes, topics } from "@/db/schema";
import { replaceNoteTags } from "@/lib/notes";
import { refreshNoteFts, searchNoteIds } from "@/lib/search";
import {
  getTrashCount,
  purgeNotes,
  purgeOrphans,
  restoreNotes,
  sweepTrash,
  trashNotes,
} from "@/lib/trash";
import { insertNote, insertTopic, wipeData } from "../helpers/db";

const DAY = 24 * 3600 * 1000;
const savedUploadDir = process.env.UPLOAD_DIR;

function fakeUploads(...filenames: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-trash-"));
  for (const f of filenames) fs.writeFileSync(path.join(dir, f), "fake");
  process.env.UPLOAD_DIR = dir;
  return dir;
}

function insertImage(id: string, filename: string, createdAt: number) {
  getDb()
    .insert(images)
    .values({ id, noteId: null, filename, mime: "image/png", size: 4, createdAt })
    .run();
}

function insertConversation(id: string, scopeType: "note" | "topic", scopeId: string) {
  const now = Date.now();
  getDb()
    .insert(conversations)
    .values({ id, scopeType, scopeId, title: "", createdAt: now, updatedAt: now })
    .run();
  getDb()
    .insert(messages)
    .values({ id: `${id}-m1`, conversationId: id, role: "user", content: "hi", createdAt: now })
    .run();
}

function getNote(id: string) {
  return getDb().select().from(notes).where(eq(notes.id, id)).get();
}

function countJobs(noteId: string): number {
  return getDb().select().from(aiJobs).where(eq(aiJobs.noteId, noteId)).all().length;
}

function ftsHas(noteId: string): boolean {
  const row = getSqlite()
    .prepare("SELECT COUNT(*) AS c FROM notes_fts WHERE note_id = ?")
    .get(noteId) as { c: number };
  return row.c > 0;
}

describe("trash 软删除与恢复", () => {
  beforeEach(() => wipeData());
  afterEach(() => {
    if (savedUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = savedUploadDir;
  });

  it("trashNotes 置 deleted_at、删除 FTS 行与该笔记全部 aiJobs，返回条数", () => {
    insertNote("n1", "羽毛球训练记录");
    refreshNoteFts(getDb(), "n1");
    getDb()
      .insert(aiJobs)
      .values({ id: "j1", noteId: "n1", type: "note_process", status: "pending", createdAt: 1, updatedAt: 1 })
      .run();

    expect(trashNotes(getDb(), ["n1"])).toBe(1);
    expect(getNote("n1")?.deletedAt).toBeTruthy();
    expect(ftsHas("n1")).toBe(false);
    expect(countJobs("n1")).toBe(0);
    expect(getTrashCount(getDb())).toBe(1);
  });

  it("trashNotes 幂等：已在回收站的不重复计数、不改 deleted_at，且不修改 updatedAt", () => {
    insertNote("n1", "内容");
    const before = getNote("n1")!;
    expect(trashNotes(getDb(), ["n1"])).toBe(1);
    const first = getNote("n1")!.deletedAt;
    expect(trashNotes(getDb(), ["n1", "ghost"])).toBe(0);
    expect(getNote("n1")!.deletedAt).toBe(first);
    expect(getNote("n1")!.updatedAt).toBe(before.updatedAt);
  });

  it("回收站笔记在搜索（FTS 与 LIKE 降级）中均不可见，恢复后重新可见", () => {
    insertNote("n1", "今晚羽毛球多球训练");
    refreshNoteFts(getDb(), "n1");
    expect(searchNoteIds("羽毛球").ids).toEqual(["n1"]);

    trashNotes(getDb(), ["n1"]);
    expect(searchNoteIds("羽毛球").ids).toEqual([]);
    expect(searchNoteIds("球").ids).toEqual([]);

    expect(restoreNotes(getDb(), ["n1"])).toBe(1);
    expect(getNote("n1")?.deletedAt).toBeNull();
    expect(searchNoteIds("羽毛球").ids).toEqual(["n1"]);
  });

  it("restoreNotes 对 aiStatus=pending/processing 重置为 pending 并重新入队", () => {
    insertNote("n1", "内容", { aiStatus: "processing" });
    trashNotes(getDb(), ["n1"]);
    expect(countJobs("n1")).toBe(0);

    restoreNotes(getDb(), ["n1"]);
    expect(getNote("n1")?.aiStatus).toBe("pending");
    const job = getDb()
      .select()
      .from(aiJobs)
      .where(and(eq(aiJobs.noteId, "n1"), eq(aiJobs.type, "note_process")))
      .get();
    expect(job?.status).toBe("pending");
  });

  it("restoreNotes 对 aiStatus=done/failed 不重新入队", () => {
    insertNote("n1", "内容", { aiStatus: "done" });
    insertNote("n2", "内容", { aiStatus: "failed" });
    trashNotes(getDb(), ["n1", "n2"]);
    restoreNotes(getDb(), ["n1", "n2"]);
    expect(getNote("n1")?.aiStatus).toBe("done");
    expect(getNote("n2")?.aiStatus).toBe("failed");
    expect(countJobs("n1") + countJobs("n2")).toBe(0);
  });

  it("删除主题时回收站笔记一并回落未分类，恢复后落在未分类（FK 闭环）", () => {
    insertTopic("t1", "旧主题");
    insertNote("n1", "内容", { topicId: "t1" });
    trashNotes(getDb(), ["n1"]);

    // 模拟 DELETE /api/topics/[id]：回落 update 特意不过滤 deleted_at，否则删主题违反外键
    getDb().transaction((tx) => {
      tx.update(notes)
        .set({ topicId: "inbox", topicLocked: 0, updatedAt: Date.now() })
        .where(eq(notes.topicId, "t1"))
        .run();
      tx.delete(topics).where(eq(topics.id, "t1")).run();
    });

    restoreNotes(getDb(), ["n1"]);
    expect(getNote("n1")?.topicId).toBe("inbox");
  });
});

describe("trash 彻底删除与孤儿清理", () => {
  beforeEach(() => wipeData());
  afterEach(() => {
    if (savedUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = savedUploadDir;
  });

  it("purgeNotes 物理删除 notes/note_tags/aiJobs/FTS 与 note 级会话及消息", () => {
    fakeUploads();
    insertNote("n1", "内容");
    replaceNoteTags(getDb(), "n1", ["标签"]);
    refreshNoteFts(getDb(), "n1");
    getDb()
      .insert(aiJobs)
      .values({ id: "j1", noteId: "n1", type: "note_process", status: "failed", createdAt: 1, updatedAt: 1 })
      .run();
    insertConversation("c1", "note", "n1");

    trashNotes(getDb(), ["n1"]);
    expect(purgeNotes(getDb(), ["n1"])).toBe(1);

    expect(getNote("n1")).toBeUndefined();
    expect(ftsHas("n1")).toBe(false);
    expect(countJobs("n1")).toBe(0);
    expect(getDb().select().from(conversations).all()).toEqual([]);
    expect(getDb().select().from(messages).all()).toEqual([]);
  });

  it("purgeNotes 拒绝物理删除不在回收站的笔记", () => {
    fakeUploads();
    insertNote("n1", "正常笔记");
    expect(purgeNotes(getDb(), ["n1"])).toBe(0);
    expect(getNote("n1")).toBeDefined();
  });

  it("purgeOrphans 删除无引用且过宽限期的图片（记录+文件），历史欠账一并清", () => {
    const dir = fakeUploads("orphan.png");
    insertImage("i1", "orphan.png", Date.now() - 2 * DAY);
    const r = purgeOrphans(getDb());
    expect(r.images).toBe(1);
    expect(getDb().select().from(images).all()).toEqual([]);
    expect(fs.existsSync(path.join(dir, "orphan.png"))).toBe(false);
  });

  it("purgeOrphans 保留被回收站笔记引用的图片", () => {
    const dir = fakeUploads("kept.png");
    insertImage("i1", "kept.png", Date.now() - 2 * DAY);
    insertNote("n1", "![a](/api/images/kept.png)", { deletedAt: Date.now() });
    const r = purgeOrphans(getDb());
    expect(r.images).toBe(0);
    expect(fs.existsSync(path.join(dir, "kept.png"))).toBe(true);
  });

  it("purgeOrphans 保留宽限期内的新上传图片（正在编辑未保存的场景）", () => {
    const dir = fakeUploads("fresh.png");
    insertImage("i1", "fresh.png", Date.now() - 3600 * 1000);
    const r = purgeOrphans(getDb());
    expect(r.images).toBe(0);
    expect(fs.existsSync(path.join(dir, "fresh.png"))).toBe(true);
  });

  it("purgeOrphans 图片文件已不存在时删记录不抛错", () => {
    fakeUploads();
    insertImage("i1", "gone.png", Date.now() - 2 * DAY);
    const r = purgeOrphans(getDb());
    expect(r.images).toBe(1);
    expect(getDb().select().from(images).all()).toEqual([]);
  });

  it("purgeOrphans 清理 scope 失效的会话并级联消息，保留指向回收站笔记与存活主题的", () => {
    fakeUploads();
    insertNote("n1", "内容", { deletedAt: Date.now() });
    insertTopic("t1", "存活主题");
    insertConversation("c1", "note", "n1");
    insertConversation("c2", "note", "ghost-note");
    insertConversation("c3", "topic", "t1");
    insertConversation("c4", "topic", "ghost-topic");

    const r = purgeOrphans(getDb());
    expect(r.conversations).toBe(2);
    const left = getDb().select({ id: conversations.id }).from(conversations).all().map((c) => c.id).sort();
    expect(left).toEqual(["c1", "c3"]);
    const msgs = getDb().select({ id: messages.id }).from(messages).all().map((m) => m.id).sort();
    expect(msgs).toEqual(["c1-m1", "c3-m1"]);
  });

  it("sweepTrash 清除满 30 天的回收站笔记，29 天的保留", () => {
    fakeUploads();
    insertNote("n1", "过期", { deletedAt: Date.now() - 31 * DAY });
    insertNote("n2", "未到期", { deletedAt: Date.now() - 29 * DAY });
    const r = sweepTrash(getDb());
    expect(r.purged).toBe(1);
    expect(getNote("n1")).toBeUndefined();
    expect(getNote("n2")).toBeDefined();
    expect(getTrashCount(getDb())).toBe(1);
  });
});
