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

export type LlmConfigSource = "db" | "env" | "none";

export interface LlmConfig {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  sources: { baseUrl: LlmConfigSource; apiKey: LlmConfigSource; model: LlmConfigSource };
  // settings 表中存在任一 LLM 配置项
  hasDbConfig: boolean;
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
  // settings 表中存在任一视觉配置项
  hasDbConfig: boolean;
}

// 视觉模型配置：settings 表优先、VISION_* 环境变量次之，baseUrl/apiKey 缺省回落文本模型
export function getVisionConfig(): VisionConfig {
  const db = getDb();
  const rows = db
    .select()
    .from(settings)
    .where(inArray(settings.key, Object.values(VISION_SETTING_KEYS)))
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
  const baseUrl = resolve(VISION_SETTING_KEYS.baseUrl, "VISION_BASE_URL");
  const apiKey = resolve(VISION_SETTING_KEYS.apiKey, "VISION_API_KEY");
  const model = resolve(VISION_SETTING_KEYS.model, "VISION_MODEL");

  // 未显式配置时回落文本模型，来源标 fallback；文本模型也没有才是 none
  const inherit = (
    own: { value: string | null; source: LlmConfigSource },
    inherited: string | null,
  ): VisionConfigSource => (own.source !== "none" ? own.source : inherited ? "fallback" : "none");

  return {
    baseUrl: baseUrl.value ?? text.baseUrl,
    apiKey: apiKey.value ?? text.apiKey,
    // 模型名不回落：只有显式配置了视觉模型名，AI 读图才可用
    model: model.value,
    sources: {
      baseUrl: inherit(baseUrl, text.baseUrl),
      apiKey: inherit(apiKey, text.apiKey),
      model: model.source,
    },
    hasDbConfig: dbMap.size > 0,
  };
}

// 视觉能力可用：至少显式配置了视觉模型名
export function isVisionConfigured(): boolean {
  const c = getVisionConfig();
  return Boolean(c.baseUrl && c.apiKey && c.model);
}

// 当前模型是否支持工具调用：由「测试连接」探测后写入，助手据此决定是否降级为纯问答
export const TOOL_SUPPORT_KEY = "llm_supports_tools";

export function saveToolSupport(supported: boolean): void {
  const db = getDb();
  const now = Date.now();
  const value = supported ? "1" : "0";
  db.insert(settings)
    .values({ key: TOOL_SUPPORT_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
    .run();
}

// null = 从未探测过（与"探测过且不支持"区分：前者应提示用户去测一次）
export function getToolSupport(): boolean | null {
  const db = getDb();
  const row = db.select().from(settings).where(eq(settings.key, TOOL_SUPPORT_KEY)).get();
  return row ? row.value === "1" : null;
}
