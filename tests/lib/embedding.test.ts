import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiJobs, noteChunks, notes, settings } from "@/db/schema";
import { embedTexts } from "@/lib/ai/embedding";
import { getEmbeddingConfig, isEmbeddingConfigured } from "@/lib/llm-config";
import { runJob } from "@/lib/ai/worker";
import { insertNote, wipeData } from "../helpers/db";

beforeEach(() => {
  wipeData();
  delete process.env.EMBEDDING_BASE_URL;
  delete process.env.EMBEDDING_API_KEY;
  delete process.env.EMBEDDING_MODEL;
});

afterEach(() => vi.unstubAllGlobals());

describe("Embedding 配置与请求", () => {
  it("不继承文本模型配置，三项齐全才启用", () => {
    const cfg = getEmbeddingConfig();
    expect(cfg.baseUrl).toBeNull();
    expect(cfg.model).toBeNull();
    expect(isEmbeddingConfigured()).toBe(false);
    getDb().insert(settings).values([
      { key: "embedding_base_url", value: "https://embed.example/v1", updatedAt: Date.now() },
      { key: "embedding_api_key", value: "sk-embed", updatedAt: Date.now() },
      { key: "embedding_model", value: "embed-model", updatedAt: Date.now() },
    ]).run();
    expect(isEmbeddingConfigured()).toBe(true);
  });

  it("按输入顺序解析批量向量", async () => {
    process.env.EMBEDDING_BASE_URL = "https://embed.example/v1";
    process.env.EMBEDDING_API_KEY = "sk-embed";
    process.env.EMBEDDING_MODEL = "embed-model";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }),
      headers: new Headers(),
    })));
    await expect(embedTexts(["a", "b"])).resolves.toEqual([[1, 0], [0, 1]]);
  });
});

describe("embed_note 任务", () => {
  it("写入向量、模型标识、维度与正文版本", async () => {
    process.env.EMBEDDING_BASE_URL = "https://embed.example/v1";
    process.env.EMBEDDING_API_KEY = "sk-embed";
    process.env.EMBEDDING_MODEL = "embed-model";
    insertNote("n1", "又摸鱼了一下午", { title: "工作记录", summary: "拖延" });
    const note = getDb().select().from(notes).where(eq(notes.id, "n1")).get()!;
    const jobId = "job-embed";
    getDb().insert(aiJobs).values({ id: jobId, noteId: "n1", type: "embed_note", status: "pending", runAfter: 0, createdAt: Date.now(), updatedAt: Date.now() }).run();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }), headers: new Headers() })));
    await runJob(getDb(), jobId);
    const saved = getDb().select().from(notes).where(eq(notes.id, "n1")).get()!;
    expect(saved.embedding).toBeTruthy();
    expect(saved.embeddingModel).toBe("embed-model");
    expect(saved.embeddingDim).toBe(3);
    expect(saved.embeddingUpdatedAt).toBe(note.updatedAt);
    expect(getDb().select().from(aiJobs).where(eq(aiJobs.id, jobId)).get()?.status).toBe("done");
  });
});

// 三节各 500 字，按 ## 切出 3 块
const LONG_CONTENT = ["第一节", "第二节", "第三节"]
  .map((h, i) => `## ${h}\n${"甲乙丙"[i].repeat(500)}`)
  .join("\n\n");

function configureEmbedding() {
  process.env.EMBEDDING_BASE_URL = "https://embed.example/v1";
  process.env.EMBEDDING_API_KEY = "sk-embed";
  process.env.EMBEDDING_MODEL = "embed-model";
}

// 按请求里的 input 条数返回同样多的向量，用于观察「几块走了几次请求」
function stubEmbed(onRequest?: () => void) {
  const fn = vi.fn(async (_url: string, init: { body: string }) => {
    onRequest?.();
    const input = (JSON.parse(init.body) as { input: string[] }).input;
    return {
      ok: true,
      json: async () => ({ data: input.map((_, i) => ({ index: i, embedding: [i + 1, 0, 0] })) }),
      headers: new Headers(),
    };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function runEmbedJob(noteId: string, jobId: string) {
  getDb()
    .insert(aiJobs)
    .values({ id: jobId, noteId, type: "embed_note", status: "pending", runAfter: 0, createdAt: Date.now(), updatedAt: Date.now() })
    .run();
  await runJob(getDb(), jobId);
}

function chunksOf(noteId: string) {
  return getDb().select().from(noteChunks).where(eq(noteChunks.noteId, noteId)).orderBy(noteChunks.chunkIndex).all();
}

describe("embed_note 的分块写入", () => {
  it("长笔记写进 note_chunks，notes.embedding 置空以免同一条笔记被算两次分", async () => {
    configureEmbedding();
    insertNote("n1", LONG_CONTENT, { title: "长笔记" });
    const note = getDb().select().from(notes).where(eq(notes.id, "n1")).get()!;
    stubEmbed();

    await runEmbedJob("n1", "job-1");

    const chunks = chunksOf("n1");
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    for (const c of chunks) {
      expect(c.embedding).toBeTruthy();
      expect(c.embeddingModel).toBe("embed-model");
      expect(c.embeddingDim).toBe(3);
      expect(c.embeddingUpdatedAt).toBe(note.updatedAt);
    }
    const saved = getDb().select().from(notes).where(eq(notes.id, "n1")).get()!;
    expect(saved.embedding).toBeNull();
    expect(saved.embeddingChunkCount).toBe(3);
    // 模型与正文版本仍记在 notes 上：stale 判定与幂等都要靠它，不必逐块回表
    expect(saved.embeddingModel).toBe("embed-model");
    expect(saved.embeddingUpdatedAt).toBe(note.updatedAt);
  });

  it("一条笔记的所有块合并成一次请求——批量能力已有，请求数不该随块数翻倍", async () => {
    configureEmbedding();
    insertNote("n1", LONG_CONTENT, { title: "长笔记" });
    const fetchMock = stubEmbed();

    await runEmbedJob("n1", "job-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("短笔记仍走 notes.embedding，不产生块行", async () => {
    configureEmbedding();
    insertNote("n1", "一句话正文", { title: "短笔记" });
    stubEmbed();

    await runEmbedJob("n1", "job-1");

    expect(chunksOf("n1")).toHaveLength(0);
    const saved = getDb().select().from(notes).where(eq(notes.id, "n1")).get()!;
    expect(saved.embedding).toBeTruthy();
    expect(saved.embeddingChunkCount).toBe(1);
  });

  it("多块笔记重复入队不再请求", async () => {
    configureEmbedding();
    insertNote("n1", LONG_CONTENT, { title: "长笔记" });
    const fetchMock = stubEmbed();

    await runEmbedJob("n1", "job-1");
    await runEmbedJob("n1", "job-2");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chunksOf("n1")).toHaveLength(3);
  });

  it("正文从长改短后旧块被清除，两侧不留双份向量", async () => {
    configureEmbedding();
    insertNote("n1", LONG_CONTENT, { title: "长笔记" });
    stubEmbed();
    await runEmbedJob("n1", "job-1");
    expect(chunksOf("n1")).toHaveLength(3);

    getDb().update(notes).set({ content: "改短了", updatedAt: Date.now() + 1000 }).where(eq(notes.id, "n1")).run();
    await runEmbedJob("n1", "job-2");

    expect(chunksOf("n1")).toHaveLength(0);
    const saved = getDb().select().from(notes).where(eq(notes.id, "n1")).get()!;
    expect(saved.embedding).toBeTruthy();
    expect(saved.embeddingChunkCount).toBe(1);
  });

  it("正文从短改长后 notes.embedding 被清空", async () => {
    configureEmbedding();
    insertNote("n1", "一句话正文", { title: "笔记" });
    stubEmbed();
    await runEmbedJob("n1", "job-1");
    expect(getDb().select().from(notes).where(eq(notes.id, "n1")).get()!.embedding).toBeTruthy();

    getDb().update(notes).set({ content: LONG_CONTENT, updatedAt: Date.now() + 1000 }).where(eq(notes.id, "n1")).run();
    await runEmbedJob("n1", "job-2");

    const saved = getDb().select().from(notes).where(eq(notes.id, "n1")).get()!;
    expect(saved.embedding).toBeNull();
    expect(saved.embeddingChunkCount).toBe(3);
    expect(chunksOf("n1")).toHaveLength(3);
  });

  it("分块上线前算的整篇向量会被重算，不被幂等挡住", async () => {
    configureEmbedding();
    insertNote("n1", LONG_CONTENT, { title: "升级前就存在的长笔记" });
    const note = getDb().select().from(notes).where(eq(notes.id, "n1")).get()!;
    /* 旧版本写入的形态：模型与正文版本都对得上，只是没有 chunk_count。
       若按「有向量就算新鲜」判定，这条笔记会被永远挡在分块之外 */
    getDb()
      .update(notes)
      .set({
        embedding: Buffer.from(new Float32Array([9, 9, 9]).buffer),
        embeddingModel: "embed-model",
        embeddingDim: 3,
        embeddingUpdatedAt: note.updatedAt,
        embeddingChunkCount: null,
      })
      .where(eq(notes.id, "n1"))
      .run();
    const fetchMock = stubEmbed();

    await runEmbedJob("n1", "job-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chunksOf("n1")).toHaveLength(3);
    expect(getDb().select().from(notes).where(eq(notes.id, "n1")).get()!.embedding).toBeNull();
  });

  it("正文在请求期间变化时一块都不写，任务退回重跑", async () => {    configureEmbedding();
    insertNote("n1", LONG_CONTENT, { title: "长笔记" });
    // 请求在途期间正文被改：旧向量必须整批丢弃，不能半新半旧地落库
    stubEmbed(() => {
      getDb().update(notes).set({ updatedAt: Date.now() + 5000 }).where(eq(notes.id, "n1")).run();
    });

    await runEmbedJob("n1", "job-1");

    expect(chunksOf("n1")).toHaveLength(0);
    const job = getDb().select().from(aiJobs).where(eq(aiJobs.id, "job-1")).get()!;
    expect(job.status).toBe("pending");
    expect(getDb().select().from(notes).where(eq(notes.id, "n1")).get()!.embeddingChunkCount).toBeNull();
  });
});
