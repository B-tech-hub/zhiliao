import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { noteChunks, notes } from "@/db/schema";
import { insertNote, wipeData } from "../helpers/db";

async function get() {
  const { GET } = await import("@/app/api/embedding/backfill/route");
  return (await GET()).json() as Promise<{ missing: number; stale: number; configured: boolean }>;
}

function vec(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

// 短笔记：整篇向量落在 notes.embedding
function attachSingle(id: string, model = "embed-model") {
  const note = getDb().select().from(notes).where(eq(notes.id, id)).get()!;
  getDb()
    .update(notes)
    .set({ embedding: vec([1, 0, 0]), embeddingModel: model, embeddingDim: 3, embeddingUpdatedAt: note.updatedAt, embeddingChunkCount: 1 })
    .where(eq(notes.id, id))
    .run();
}

// 长笔记：notes.embedding 为空，向量在 note_chunks
function attachChunked(id: string, count = 3, model = "embed-model") {
  const note = getDb().select().from(notes).where(eq(notes.id, id)).get()!;
  getDb()
    .insert(noteChunks)
    .values(Array.from({ length: count }, (_, i) => ({
      id: `${id}-c${i}`,
      noteId: id,
      chunkIndex: i,
      text: `第 ${i} 块`,
      embedding: vec([1, 0, 0]),
      embeddingModel: model,
      embeddingDim: 3,
      embeddingUpdatedAt: note.updatedAt,
    })))
    .run();
  getDb()
    .update(notes)
    .set({ embedding: null, embeddingModel: model, embeddingDim: 3, embeddingUpdatedAt: note.updatedAt, embeddingChunkCount: count })
    .where(eq(notes.id, id))
    .run();
}

beforeEach(() => {
  wipeData();
  process.env.EMBEDDING_BASE_URL = "https://embed.example/v1";
  process.env.EMBEDDING_API_KEY = "sk-embed";
  process.env.EMBEDDING_MODEL = "embed-model";
});

describe("待补算计数在分块存储下的口径", () => {
  it("多块笔记不算缺失——notes.embedding 为空是设计而非漏算", async () => {
    insertNote("n1", "长笔记");
    attachChunked("n1");

    await expect(get()).resolves.toMatchObject({ missing: 0, stale: 0 });
  });

  it("完全没算过的笔记才算缺失", async () => {
    insertNote("n1", "从未补算");
    insertNote("n2", "短笔记");
    attachSingle("n2");

    await expect(get()).resolves.toMatchObject({ missing: 1, stale: 0 });
  });

  it("换模型后多块笔记按笔记计一次过期，不按块累加", async () => {
    insertNote("n1", "长笔记");
    attachChunked("n1", 5, "旧模型");

    // 5 块的笔记若按块累加会显示「过期 5」，用户看到的数字与笔记数脱钩
    await expect(get()).resolves.toMatchObject({ missing: 0, stale: 1 });
  });

  it("正文改过但向量没跟上的多块笔记算过期", async () => {
    insertNote("n1", "长笔记");
    attachChunked("n1");
    getDb().update(notes).set({ updatedAt: Date.now() + 10_000 }).where(eq(notes.id, "n1")).run();

    await expect(get()).resolves.toMatchObject({ missing: 0, stale: 1 });
  });

  it("回收站笔记不计入——补算它们是白花钱", async () => {
    insertNote("n1", "已删除且从未补算", { deletedAt: Date.now() });

    await expect(get()).resolves.toMatchObject({ missing: 0, stale: 0 });
  });

  it("分块上线前算的整篇向量一律待补算——否则存量长笔记永远吃不到分块", async () => {
    insertNote("n1", "升级前就存在的笔记");
    const note = getDb().select().from(notes).where(eq(notes.id, "n1")).get()!;
    // 旧版本写入的形态：模型与正文版本都对得上，只是 chunk_count 还没有这个概念
    getDb()
      .update(notes)
      .set({ embedding: vec([1, 0, 0]), embeddingModel: "embed-model", embeddingDim: 3, embeddingUpdatedAt: note.updatedAt, embeddingChunkCount: null })
      .where(eq(notes.id, "n1"))
      .run();

    await expect(get()).resolves.toMatchObject({ missing: 0, stale: 1 });
  });
});
