import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { noteChunks, notes } from "@/db/schema";
import { purgeNotes, sweepTrash, trashNotes } from "@/lib/trash";
import { insertNote, wipeData } from "../helpers/db";

const DAY = 24 * 3600 * 1000;

// 造一条带 N 块向量的笔记。向量内容与检索无关，本文件只验证行的生命周期
function insertChunks(noteId: string, count: number) {
  const db = getDb();
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    db.insert(noteChunks)
      .values({
        id: `${noteId}-c${i}`,
        noteId,
        chunkIndex: i,
        text: `第 ${i} 块正文`,
        embedding: Buffer.from(new Float32Array([i, i, i]).buffer),
        embeddingModel: "test-model",
        embeddingDim: 3,
        embeddingUpdatedAt: now,
      })
      .run();
  }
  db.update(notes).set({ embeddingChunkCount: count }).where(eq(notes.id, noteId)).run();
}

function chunkCount(noteId: string): number {
  return (
    getSqlite()
      .prepare("SELECT COUNT(*) AS c FROM note_chunks WHERE note_id = ?")
      .get(noteId) as { c: number }
  ).c;
}

describe("note_chunks 的生命周期", () => {
  beforeEach(() => {
    wipeData();
  });

  it("彻底删除多块笔记后不留孤儿块", () => {
    const db = getDb();
    insertNote("n1", "长笔记正文");
    insertNote("n2", "另一条长笔记");
    insertChunks("n1", 4);
    insertChunks("n2", 3);

    trashNotes(db, ["n1"]);
    expect(purgeNotes(db, ["n1"])).toBe(1);

    expect(chunkCount("n1")).toBe(0);
    // 未被删除的笔记不受影响，级联范围必须精确到 note_id
    expect(chunkCount("n2")).toBe(3);
  });

  it("移入回收站不删块——笔记还能恢复，删了就得重新花钱补算", () => {
    const db = getDb();
    insertNote("n1", "长笔记正文");
    insertChunks("n1", 4);

    trashNotes(db, ["n1"]);

    expect(chunkCount("n1")).toBe(4);
  });

  it("回收站过期清扫同样带走块", () => {
    const db = getDb();
    insertNote("n1", "长笔记正文", { deletedAt: Date.now() - 40 * DAY });
    insertChunks("n1", 5);

    sweepTrash(db);

    expect(chunkCount("n1")).toBe(0);
  });

  it("直接删除 notes 行也会级联——孤儿由外键兜底，不依赖调用方记得成对删", () => {
    insertNote("n1", "长笔记正文");
    insertChunks("n1", 3);

    getSqlite().prepare("DELETE FROM notes WHERE id = ?").run("n1");

    expect(chunkCount("n1")).toBe(0);
  });
});
