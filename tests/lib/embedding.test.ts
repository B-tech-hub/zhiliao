import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiJobs, notes, settings } from "@/db/schema";
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
