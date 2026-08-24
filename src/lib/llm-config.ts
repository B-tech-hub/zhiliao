// LLM 配置合并层：settings 表优先，环境变量兜底。
// worker 与 API 路由同进程共享同一 SQLite 连接，每次现读即天然保证"保存后立即生效"，无需缓存。

import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { settings } from "@/db/schema";

export const LLM_SETTING_KEYS = {
  baseUrl: "llm_base_url",
  apiKey: "llm_api_key",
  model: "llm_model",
} as const;

// 视觉模型独立配置：留空的项回落到文本模型配置（只填 model 即可用同一端点）
export const VISION_SETTING_KEYS = {
  baseUrl: "vision_base_url",
  apiKey: "vision_api_key",
  model: "vision_model",
} as const;

// 图像生成独立配置：与视觉模型同样的回落规则（模型名不回落）
export const IMAGE_SETTING_KEYS = {
  baseUrl: "image_base_url",
  apiKey: "image_api_key",
  model: "image_model",
} as const;
// 深度思考（推理）模型独立配置：回落规则同视觉/图像，环境变量前缀 REASONING_*
export const REASONING_SETTING_KEYS = {
  baseUrl: "reasoning_base_url",
  apiKey: "reasoning_api_key",
  model: "reasoning_model",
} as const;

// 嵌入模型配置不继承文本模型：DeepSeek/Anthropic 等聊天供应商不一定提供 embeddings。
export const EMBEDDING_SETTING_KEYS = {
  baseUrl: "embedding_base_url",
  apiKey: "embedding_api_key",
  model: "embedding_model",
} as const;

export type LlmConfigSource = "db" | "env" | "none";

export interface LlmConfig {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  sources: { baseUrl: LlmConfigSource; apiKey: LlmConfigSource; model: LlmConfigSource };
  // settings 表中存在任一 LLM 配置项
  hasDbConfig: boolean;
}

export type EmbeddingConfigSource = LlmConfigSource;
export interface EmbeddingConfig {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  sources: { baseUrl: EmbeddingConfigSource; apiKey: EmbeddingConfigSource; model: EmbeddingConfigSource };
  hasDbConfig: boolean;
}

export function getEmbeddingConfig(): EmbeddingConfig {
  const db = getDb();
  const rows = db.select().from(settings).where(inArray(settings.key, Object.values(EMBEDDING_SETTING_KEYS))).all();
  const dbMap = new Map(rows.map((r) => [r.key, r.value]));
  const resolve = (key: string, envName: string) => {
    const dbValue = dbMap.get(key)?.trim();
    if (dbValue) return { value: dbValue, source: "db" as const };
    const envValue = process.env[envName]?.trim();
    if (envValue) return { value: envValue, source: "env" as const };
    return { value: null, source: "none" as const };
  };
  const baseUrl = resolve(EMBEDDING_SETTING_KEYS.baseUrl, "EMBEDDING_BASE_URL");
  const apiKey = resolve(EMBEDDING_SETTING_KEYS.apiKey, "EMBEDDING_API_KEY");
  const model = resolve(EMBEDDING_SETTING_KEYS.model, "EMBEDDING_MODEL");
  return {
    baseUrl: baseUrl.value,
    apiKey: apiKey.value,
    model: model.value,
    sources: { baseUrl: baseUrl.source, apiKey: apiKey.source, model: model.source },
    hasDbConfig: dbMap.size > 0,
  };
}

export function isEmbeddingConfigured(): boolean {
  const c = getEmbeddingConfig();
  return Boolean(c.baseUrl && c.apiKey && c.model);
}

export function getLlmConfig(): LlmConfig {
  const db = getDb();
  const rows = db
    .select()
    .from(settings)
    .where(inArray(settings.key, Object.values(LLM_SETTING_KEYS)))
    .all();
  const dbMap = new Map(rows.map((r) => [r.key, r.value]));

  function resolve(key: string, envName: string): { value: string | null; source: LlmConfigSource } {
    const fromDb = dbMap.get(key)?.trim();
    if (fromDb) return { value: fromDb, source: "db" };
    const fromEnv = process.env[envName]?.trim();
    if (fromEnv) return { value: fromEnv, source: "env" };
    return { value: null, source: "none" };
  }

  const baseUrl = resolve(LLM_SETTING_KEYS.baseUrl, "LLM_BASE_URL");
  const apiKey = resolve(LLM_SETTING_KEYS.apiKey, "LLM_API_KEY");
  const model = resolve(LLM_SETTING_KEYS.model, "LLM_MODEL");

  return {
    baseUrl: baseUrl.value,
    apiKey: apiKey.value,
    model: model.value,
    sources: { baseUrl: baseUrl.source, apiKey: apiKey.source, model: model.source },
    hasDbConfig: dbMap.size > 0,
  };
}

// 视觉配置比文本配置多一个来源态：fallback = 未显式配置，回落文本模型
export type VisionConfigSource = LlmConfigSource | "fallback";

export interface VisionConfig {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  sources: { baseUrl: VisionConfigSource; apiKey: VisionConfigSource; model: VisionConfigSource };
  // settings 表中存在任一该组配置项
  hasDbConfig: boolean;
}

/* 视觉与图像两组附加配置的共同形态：接入点与 API Key 缺省回落文本模型，
   模型名不回落——只有显式填了模型名，该能力才算启用。两组的差异只有
   settings key 与环境变量前缀，各抄一份迟早漂移，共用这一段。 */
function getDerivedConfig(
  keys: { baseUrl: string; apiKey: string; model: string },
  envPrefix: string,
): VisionConfig {
  const db = getDb();
  const rows = db
    .select()
    .from(settings)
    .where(inArray(settings.key, Object.values(keys)))
    .all();
  const dbMap = new Map(rows.map((r) => [r.key, r.value]));

  function resolve(key: string, envName: string): { value: string | null; source: LlmConfigSource } {
    const fromDb = dbMap.get(key)?.trim();
    if (fromDb) return { value: fromDb, source: "db" };
    const fromEnv = process.env[envName]?.trim();
    if (fromEnv) return { value: fromEnv, source: "env" };
    return { value: null, source: "none" };
  }

  const text = getLlmConfig();
  const baseUrl = resolve(keys.baseUrl, `${envPrefix}_BASE_URL`);
  const apiKey = resolve(keys.apiKey, `${envPrefix}_API_KEY`);
  const model = resolve(keys.model, `${envPrefix}_MODEL`);

  // 未显式配置时回落文本模型，来源标 fallback；文本模型也没有才是 none
  const inherit = (
    own: { value: string | null; source: LlmConfigSource },
    inherited: string | null,
  ): VisionConfigSource => (own.source !== "none" ? own.source : inherited ? "fallback" : "none");

  return {
    baseUrl: baseUrl.value ?? text.baseUrl,
    apiKey: apiKey.value ?? text.apiKey,
    // 模型名不回落：只有显式配置了模型名，该能力才可用
    model: model.value,
    sources: {
      baseUrl: inherit(baseUrl, text.baseUrl),
      apiKey: inherit(apiKey, text.apiKey),
      model: model.source,
    },
    hasDbConfig: dbMap.size > 0,
  };
}

// 视觉模型配置：settings 表优先、VISION_* 环境变量次之，baseUrl/apiKey 缺省回落文本模型
export function getVisionConfig(): VisionConfig {
  return getDerivedConfig(VISION_SETTING_KEYS, "VISION");
}

// 图像生成配置：规则同视觉模型，环境变量前缀 IMAGE_*
export function getImageConfig(): VisionConfig {
  return getDerivedConfig(IMAGE_SETTING_KEYS, "IMAGE");
}
// 深度思考模型配置：规则同视觉模型，环境变量前缀 REASONING_*
export function getReasoningConfig(): VisionConfig {
  return getDerivedConfig(REASONING_SETTING_KEYS, "REASONING");
}

// 深度思考可用：至少显式配置了推理模型名
export function isReasoningConfigured(): boolean {
  const c = getReasoningConfig();
  return Boolean(c.baseUrl && c.apiKey && c.model);
}

// 视觉能力可用：至少显式配置了视觉模型名
export function isVisionConfigured(): boolean {
  const c = getVisionConfig();
  return Boolean(c.baseUrl && c.apiKey && c.model);
}

// 生图能力可用：至少显式配置了图像模型名。助手据此决定要不要注册 generate_image
export function isImageGenConfigured(): boolean {
  const c = getImageConfig();
  return Boolean(c.baseUrl && c.apiKey && c.model);
}

/* 模型是否支持工具调用：由「测试连接」探测后写入，助手据此决定是否降级为纯问答。
   文本模型与深度思考模型各记一份——两者常常不是同一家供应商，
   拿文本模型的结论去决定要不要给推理模型下发 tools，两边都可能判错。 */
export const TOOL_SUPPORT_KEY = "llm_supports_tools";
export const REASONING_TOOL_SUPPORT_KEY = "reasoning_supports_tools";

function saveFlag(key: string, value: boolean): void {
  const db = getDb();
  const now = Date.now();
  const v = value ? "1" : "0";
  db.insert(settings)
    .values({ key, value: v, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: now } })
    .run();
}

// null = 从未探测过（与"探测过且不支持"区分：前者应提示用户去测一次）
function getFlag(key: string): boolean | null {
  const db = getDb();
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row ? row.value === "1" : null;
}

export function saveToolSupport(supported: boolean): void {
  saveFlag(TOOL_SUPPORT_KEY, supported);
}

export function getToolSupport(): boolean | null {
  return getFlag(TOOL_SUPPORT_KEY);
}

export function saveReasoningToolSupport(supported: boolean): void {
  saveFlag(REASONING_TOOL_SUPPORT_KEY, supported);
}

export function getReasoningToolSupport(): boolean | null {
  return getFlag(REASONING_TOOL_SUPPORT_KEY);
}
