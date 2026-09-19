import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/db";
import { settings } from "@/db/schema";
import {
  EMBEDDING_SETTING_KEYS,
  IMAGE_SETTING_KEYS,
  LLM_SETTING_KEYS,
  REASONING_SETTING_KEYS,
  VISION_SETTING_KEYS,
  getEmbeddingConfig,
  getImageConfig,
  getLlmConfig,
  getReasoningConfig,
  getVisionConfig,
  isEmbeddingConfigured,
  isImageGenConfigured,
  isReasoningConfigured,
  isVisionConfigured,
} from "@/lib/llm-config";
import { wipeData } from "../helpers/db";

// 直接写 settings 表，模拟「用户在设置页保存过配置」
function saveDb(key: string, value: string) {
  const updatedAt = Date.now();
  dbModule.getDb()
    .insert(settings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
    .run();
}

const MODEL_CONFIGS = [
  { prefix: "LLM", keys: LLM_SETTING_KEYS },
  { prefix: "EMBEDDING", keys: EMBEDDING_SETTING_KEYS },
  { prefix: "VISION", keys: VISION_SETTING_KEYS },
  { prefix: "IMAGE", keys: IMAGE_SETTING_KEYS },
  { prefix: "REASONING", keys: REASONING_SETTING_KEYS },
] as const;

beforeEach(() => {
  wipeData();
  for (const key of ["DEMO_MODE", "DEMO_RUNTIME", "DEMO_LLM_BASE_URL"]) vi.stubEnv(key, undefined);
  for (const { prefix } of MODEL_CONFIGS) {
    for (const suffix of ["BASE_URL", "API_KEY", "MODEL"]) vi.stubEnv(`${prefix}_${suffix}`, undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("配置来源遮蔽检测", () => {

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
    process.env.LLM_MODEL = "env-chat-model";
    saveDb("llm_model", "db-chat-model");
    const cfg = getLlmConfig();
    expect(cfg.model).toBe("db-chat-model");
    expect(cfg.shadowed.model).toBe("env-chat-model");
  });
});

describe("Demo 模型接线", () => {
  it.each([
    ["本机", "local", "http://127.0.0.1:8787/v1"],
    ["缺省", undefined, "http://mockllm:8787/v1"],
    ["空值", "", "http://mockllm:8787/v1"],
    ["容器", "container", "http://mockllm:8787/v1"],
    ["大小写不同", "LOCAL", "http://mockllm:8787/v1"],
    ["多余空白", " local ", "http://mockllm:8787/v1"],
    ["任意 URL", "https://attacker.invalid/v1", "http://mockllm:8787/v1"],
  ] as const)("%s标记只选择固定 mock，忽略数据库和环境污染", (_label, runtime, baseUrl) => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("DEMO_RUNTIME", runtime);
    vi.stubEnv("DEMO_LLM_BASE_URL", "https://demo-override.invalid/v1");
    for (const { prefix, keys } of MODEL_CONFIGS) {
      vi.stubEnv(`${prefix}_BASE_URL`, "https://env.invalid/v1");
      vi.stubEnv(`${prefix}_API_KEY`, "env-secret");
      vi.stubEnv(`${prefix}_MODEL`, "env-model");
      saveDb(keys.baseUrl, "https://db.invalid/v1");
      saveDb(keys.apiKey, "db-secret");
      saveDb(keys.model, "db-model");
    }
    const getDbSpy = vi.spyOn(dbModule, "getDb");

    expect(getLlmConfig()).toEqual({
      baseUrl,
      apiKey: "demo",
      model: "mock",
      sources: { baseUrl: "env", apiKey: "env", model: "env" },
      shadowed: { baseUrl: null, model: null, apiKey: false },
      hasDbConfig: false,
    });
    for (const config of [getEmbeddingConfig(), getVisionConfig(), getImageConfig(), getReasoningConfig()]) {
      expect(config).toEqual({
        baseUrl: null,
        apiKey: null,
        model: null,
        sources: { baseUrl: "none", apiKey: "none", model: "none" },
        shadowed: { baseUrl: null, model: null, apiKey: false },
        hasDbConfig: false,
      });
    }
    expect([isEmbeddingConfigured(), isVisionConfigured(), isImageGenConfigured(), isReasoningConfigured()])
      .toEqual([false, false, false, false]);
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "0", "false"])("DEMO_MODE=%s 时本机标记不改变正式配置优先级", (mode) => {
    vi.stubEnv("DEMO_MODE", mode);
    vi.stubEnv("DEMO_RUNTIME", "local");
    vi.stubEnv("LLM_BASE_URL", " https://env.invalid/v1 ");
    vi.stubEnv("LLM_API_KEY", " env-key ");
    vi.stubEnv("LLM_MODEL", " env-model ");
    saveDb(LLM_SETTING_KEYS.baseUrl, " https://db.invalid/v1 ");
    saveDb(LLM_SETTING_KEYS.model, " db-model ");
    saveDb(LLM_SETTING_KEYS.apiKey, "  ");

    expect(getLlmConfig()).toEqual({
      baseUrl: "https://db.invalid/v1",
      apiKey: "env-key",
      model: "db-model",
      sources: { baseUrl: "db", apiKey: "env", model: "db" },
      shadowed: { baseUrl: "https://env.invalid/v1", model: "env-model", apiKey: false },
      hasDbConfig: true,
    });
  });

  it("正式模式空库继续使用环境模型，未配置时返回空值", () => {
    vi.stubEnv("DEMO_RUNTIME", "local");
    vi.stubEnv("LLM_BASE_URL", "https://env.invalid/v1");
    vi.stubEnv("LLM_API_KEY", "env-key");
    vi.stubEnv("LLM_MODEL", "env-model");
    expect(getLlmConfig()).toMatchObject({
      baseUrl: "https://env.invalid/v1", apiKey: "env-key", model: "env-model", hasDbConfig: false,
      sources: { baseUrl: "env", apiKey: "env", model: "env" },
    });

    for (const key of ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]) vi.stubEnv(key, undefined);
    expect(getLlmConfig()).toEqual({
      baseUrl: null, apiKey: null, model: null, hasDbConfig: false,
      sources: { baseUrl: "none", apiKey: "none", model: "none" },
      shadowed: { baseUrl: null, model: null, apiKey: false },
    });
  });
});
