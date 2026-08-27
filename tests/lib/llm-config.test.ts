import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { EMBEDDING_SETTING_KEYS, getEmbeddingConfig, getLlmConfig } from "@/lib/llm-config";
import { wipeData } from "../helpers/db";

// 直接写 settings 表，模拟「用户在设置页保存过配置」
function saveDb(key: string, value: string) {
  const updatedAt = Date.now();
  getDb()
    .insert(settings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
    .run();
}

const ENV_KEYS = ["EMBEDDING_BASE_URL", "EMBEDDING_API_KEY", "EMBEDDING_MODEL"] as const;

describe("配置来源遮蔽检测", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    wipeData();
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /* 这条用例复现 2026-08-27 的真实事故：.env.local 写着 4B，settings 表里是 8B，
     应用静默用了 8B，把一批按 4B 算好的向量全部重算成 8B。 */
  it("数据库值遮蔽不同的环境变量值时，报出被忽略的那个值", () => {
    process.env.EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-4B";
    saveDb(EMBEDDING_SETTING_KEYS.model, "Qwen/Qwen3-Embedding-8B");

    const cfg = getEmbeddingConfig();

    expect(cfg.model).toBe("Qwen/Qwen3-Embedding-8B");
    expect(cfg.sources.model).toBe("db");
    expect(cfg.shadowed.model).toBe("Qwen/Qwen3-Embedding-4B");
  });

  it("两处值相同时不报遮蔽——没有歧义，提示只会变成噪声", () => {
    process.env.EMBEDDING_MODEL = "same-model";
    saveDb(EMBEDDING_SETTING_KEYS.model, "same-model");

    expect(getEmbeddingConfig().shadowed.model).toBeNull();
  });

  it("只有环境变量、或只有数据库时都不报遮蔽", () => {
    process.env.EMBEDDING_MODEL = "env-only";
    expect(getEmbeddingConfig().shadowed.model).toBeNull();

    delete process.env.EMBEDDING_MODEL;
    saveDb(EMBEDDING_SETTING_KEYS.model, "db-only");
    expect(getEmbeddingConfig().shadowed.model).toBeNull();
  });

  // 密钥不能出现在返回值里：这个对象会一路传到客户端组件
  it("API Key 的遮蔽只给布尔标记，不带出原值", () => {
    process.env.EMBEDDING_API_KEY = "sk-env-secret-value";
    saveDb(EMBEDDING_SETTING_KEYS.apiKey, "sk-db-secret-value");

    const cfg = getEmbeddingConfig();

    expect(cfg.shadowed.apiKey).toBe(true);
    expect(JSON.stringify(cfg.shadowed)).not.toContain("sk-env-secret-value");
  });

  it("接入点遮蔽同样报出——模型名对而接入点被换掉更隐蔽", () => {
    process.env.EMBEDDING_BASE_URL = "https://env.example.com/v1";
    saveDb(EMBEDDING_SETTING_KEYS.baseUrl, "https://db.example.com/v1");

    const cfg = getEmbeddingConfig();

    expect(cfg.baseUrl).toBe("https://db.example.com/v1");
    expect(cfg.shadowed.baseUrl).toBe("https://env.example.com/v1");
  });

  // 三份重复的 resolve 已收敛为一处，文本模型这一路必须同样具备检测能力
  it("检测对文本模型配置同样生效（收敛后不再各写一份）", () => {
    const savedModel = process.env.LLM_MODEL;
    process.env.LLM_MODEL = "env-chat-model";
    saveDb("llm_model", "db-chat-model");
    try {
      const cfg = getLlmConfig();
      expect(cfg.model).toBe("db-chat-model");
      expect(cfg.shadowed.model).toBe("env-chat-model");
    } finally {
      process.env.LLM_MODEL = savedModel;
    }
  });
});
