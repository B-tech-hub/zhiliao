import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { noteChunks, notes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hybridSearchNoteIds, refreshNoteFts, vectorSearch } from "@/lib/search";
import { insertNote, wipeData } from "../helpers/db";

// 向量按 Float32Array 字节序列落库，与 worker 写入侧保持一致
function vec(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

// 给笔记挂上向量。model 缺省即当前配置模型，传别的值用来模拟模型漂移。
function attachEmbedding(id: string, values: number[], model = "embed-model") {
  const note = getDb().select().from(notes).where(eq(notes.id, id)).get()!;
  getDb()
    .update(notes)
    .set({ embedding: vec(values), embeddingModel: model, embeddingDim: values.length, embeddingUpdatedAt: note.updatedAt })
    .where(eq(notes.id, id))
    .run();
}

// 查询向量由 mock 的 /embeddings 返回，方向由测试指定
function stubQueryVector(vector: number[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ index: 0, embedding: vector }] }), headers: new Headers() })),
  );
}

function enableEmbedding() {
  process.env.EMBEDDING_BASE_URL = "https://embed.example/v1";
  process.env.EMBEDDING_API_KEY = "sk-embed";
  process.env.EMBEDDING_MODEL = "embed-model";
}

beforeEach(() => {
  wipeData();
  delete process.env.EMBEDDING_BASE_URL;
  delete process.env.EMBEDDING_API_KEY;
  delete process.env.EMBEDDING_MODEL;
});

afterEach(() => vi.unstubAllGlobals());

describe("混合检索的最小可信证明", () => {
  // 计划 §1：正文写「又摸鱼了一下午」，搜「拖延」要能召回——措辞完全不同
  it("口语化措辞的笔记能被语义相近的查询召回", async () => {
    enableEmbedding();
    insertNote("n1", "又摸鱼了一下午");
    insertNote("n2", "今晚羽毛球多球训练");
    refreshNoteFts(getDb(), "n1");
    refreshNoteFts(getDb(), "n2");
    attachEmbedding("n1", [1, 0, 0, 0]); // 摸鱼/拖延同方向
    attachEmbedding("n2", [0, 1, 0, 0]);
    stubQueryVector([1, 0, 0, 0]); // 「拖延」的查询向量

    const result = await hybridSearchNoteIds("拖延", 10);
    expect(result.vectorEnabled).toBe(true);
    expect(result.ids).toContain("n1");
    // 「拖延」二字在两条笔记里都不存在，纯 BM25 拿不到 n1
    expect(result.ids[0]).toBe("n1");
  });

  it("未配置 Embedding 时降级为纯 BM25，行为与配置前一致", async () => {
    insertNote("n1", "又摸鱼了一下午");
    refreshNoteFts(getDb(), "n1");
    const result = await hybridSearchNoteIds("拖延", 10);
    expect(result.vectorEnabled).toBe(false);
    expect(result.staleEmbeddingCount).toBe(0);
    expect(result.ids).not.toContain("n1");
  });

  it("Embedding 供应商不可用时降级为 BM25 而非报错", async () => {
    enableEmbedding();
    insertNote("n1", "羽毛球训练记录");
    refreshNoteFts(getDb(), "n1");
    attachEmbedding("n1", [1, 0, 0, 0]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect ECONNREFUSED"); }));

    const result = await hybridSearchNoteIds("羽毛球", 10);
    expect(result.vectorEnabled).toBe(false);
    expect(result.ids).toContain("n1"); // BM25 仍然可用
  });
});

describe("模型漂移降级（计划 §3.3 最需守住的一条）", () => {
  it("异模型向量不参与相似度计算，并计入提示条数", async () => {
    enableEmbedding();
    insertNote("n1", "又摸鱼了一下午");
    insertNote("n2", "上周也拖了很久没动手");
    refreshNoteFts(getDb(), "n1");
    refreshNoteFts(getDb(), "n2");
    attachEmbedding("n1", [1, 0, 0, 0]);
    attachEmbedding("n2", [1, 0, 0, 0], "旧模型"); // 模型漂移
    stubQueryVector([1, 0, 0, 0]);

    const result = await hybridSearchNoteIds("拖延", 10);
    expect(result.ids).toContain("n1");
    expect(result.staleEmbeddingCount).toBe(1);
  });

  it("模型名相同但维度不同的向量同样被排除且计入提示", () => {
    enableEmbedding();
    insertNote("n1", "又摸鱼了一下午");
    // 供应商调整了默认输出维度：只比模型名会让这批笔记被静默排除
    attachEmbedding("n1", [1, 0, 0, 0, 0, 0]);

    const result = vectorSearch([1, 0, 0, 0], 10);
    expect(result.ids).toEqual([]);
    expect(result.staleEmbeddingCount).toBe(1);
  });

  it("零向量算不出相似度，不得以哨兵分占据结果名额", () => {
    enableEmbedding();
    insertNote("n1", "正常笔记");
    insertNote("n2", "零向量笔记");
    attachEmbedding("n1", [1, 0, 0, 0]);
    attachEmbedding("n2", [0, 0, 0, 0]);

    const result = vectorSearch([1, 0, 0, 0], 10);
    expect(result.ids).toEqual(["n1"]);
    expect(result.staleEmbeddingCount).toBe(1);
  });

  it("限定候选范围时，提示条数只统计范围内的笔记", () => {
    enableEmbedding();
    insertNote("n1", "范围内的旧向量");
    insertNote("n2", "范围外的旧向量");
    attachEmbedding("n1", [1, 0, 0, 0], "旧模型");
    attachEmbedding("n2", [1, 0, 0, 0], "旧模型");

    const result = vectorSearch([1, 0, 0, 0], 10, new Set(["n1"]));
    expect(result.staleEmbeddingCount).toBe(1);
  });
});

// 给笔记挂分块向量，并把 notes 一侧按 worker 的写法置空
function attachChunks(id: string, chunks: { values: number[]; model?: string }[]) {
  const note = getDb().select().from(notes).where(eq(notes.id, id)).get()!;
  getDb()
    .insert(noteChunks)
    .values(chunks.map((c, i) => ({
      id: `${id}-c${i}`,
      noteId: id,
      chunkIndex: i,
      text: `第 ${i} 块`,
      embedding: vec(c.values),
      embeddingModel: c.model ?? "embed-model",
      embeddingDim: c.values.length,
      embeddingUpdatedAt: note.updatedAt,
    })))
    .run();
  getDb().update(notes).set({ embedding: null, embeddingChunkCount: chunks.length }).where(eq(notes.id, id)).run();
}

describe("分块检索的 max-pooling", () => {
  it("取最高分块而非平均——平均会让长笔记再次被稀释，等于白分块", () => {
    enableEmbedding();
    insertNote("n1", "三节长笔记");
    insertNote("n2", "一节短笔记");
    // n1 块分数为 1 / 0 / 0：max=1 胜过 n2 的 0.707，avg=0.333 则会输
    attachChunks("n1", [{ values: [1, 0, 0] }, { values: [0, 1, 0] }, { values: [0, 0, 1] }]);
    attachEmbedding("n2", [1, 1, 0]);

    const result = vectorSearch([1, 0, 0], 10);
    expect(result.ids[0]).toBe("n1");
    expect(result.scores["n1"]).toBeCloseTo(1, 5);
  });

  it("单块笔记与多块笔记同场排序，短笔记不因别人分块而掉队", () => {
    enableEmbedding();
    insertNote("n1", "短笔记正好命中");
    insertNote("n2", "长笔记只是沾边");
    attachEmbedding("n1", [1, 0, 0]);
    attachChunks("n2", [{ values: [1, 1, 0] }, { values: [0, 1, 0] }]);

    const result = vectorSearch([1, 0, 0], 10);
    expect(result.ids).toEqual(["n1", "n2"]);
  });

  it("回收站笔记的块不参与检索——note_chunks 自己没有软删标记", () => {
    enableEmbedding();
    insertNote("n1", "已删除的长笔记", { deletedAt: Date.now() });
    insertNote("n2", "正常短笔记");
    attachChunks("n1", [{ values: [1, 0, 0] }]);
    attachEmbedding("n2", [0, 1, 0]);

    const result = vectorSearch([1, 0, 0], 10);
    expect(result.ids).not.toContain("n1");
  });

  it("多块笔记的陈旧提示按笔记计一次，不按块累加", () => {
    enableEmbedding();
    insertNote("n1", "换模型后作废的长笔记");
    attachChunks("n1", [
      { values: [1, 0, 0], model: "旧模型" },
      { values: [0, 1, 0], model: "旧模型" },
      { values: [0, 0, 1], model: "旧模型" },
    ]);

    const result = vectorSearch([1, 0, 0], 10);
    expect(result.ids).toEqual([]);
    // 按块累加会让「3 条待补算」变成「9 条」，用户看到的数字与笔记数脱钩
    expect(result.staleEmbeddingCount).toBe(1);
  });

  it("只要有一块能算分，这条笔记就参与排序且不计入陈旧", () => {
    enableEmbedding();
    insertNote("n1", "补算到一半的长笔记");
    attachChunks("n1", [
      { values: [1, 0, 0], model: "旧模型" },
      { values: [1, 0, 0] },
      { values: [0, 0, 0] },
    ]);

    const result = vectorSearch([1, 0, 0], 10);
    expect(result.ids).toEqual(["n1"]);
    expect(result.staleEmbeddingCount).toBe(0);
  });

  it("限定候选范围对块同样生效", () => {
    enableEmbedding();
    insertNote("n1", "范围内的长笔记");
    insertNote("n2", "范围外的长笔记");
    attachChunks("n1", [{ values: [1, 0, 0] }]);
    attachChunks("n2", [{ values: [1, 0, 0] }]);

    const result = vectorSearch([1, 0, 0], 10, new Set(["n1"]));
    expect(result.ids).toEqual(["n1"]);
  });

  it("两侧都有向量时也只出现一次——互斥若被破坏，排序不能因此错乱", () => {
    enableEmbedding();
    insertNote("n1", "异常状态：两侧都有向量");
    attachChunks("n1", [{ values: [0, 1, 0] }]);
    // 绕过 worker 的互斥直接写回 notes 一侧，模拟数据异常
    getDb().update(notes).set({ embedding: vec([1, 0, 0]), embeddingModel: "embed-model", embeddingDim: 3 }).where(eq(notes.id, "n1")).run();

    const result = vectorSearch([1, 0, 0], 10);
    expect(result.ids).toEqual(["n1"]);
    expect(result.scores["n1"]).toBeCloseTo(1, 5);
  });
});
