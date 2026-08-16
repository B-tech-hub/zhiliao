import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { LLM_SETTING_KEYS, IMAGE_SETTING_KEYS, VISION_SETTING_KEYS } from "@/lib/llm-config";

// 仅携带需要修改的字段；apiKey 留空时前端不携带，避免误覆盖
const patchSchema = z.object({
  baseUrl: z.string().trim().url("接入点需为完整 URL，如 https://api.openai.com/v1").optional(),
  apiKey: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  // 视觉模型（可选，独立配置；传空字符串表示清除该项）
  visionBaseUrl: z.union([z.string().trim().url("接入点需为完整 URL"), z.literal("")]).optional(),
  visionApiKey: z.string().trim().optional(),
  visionModel: z.string().trim().optional(),
  // 图像生成（可选，独立配置；规则同视觉模型）
  imageBaseUrl: z.union([z.string().trim().url("接入点需为完整 URL"), z.literal("")]).optional(),
  imageApiKey: z.string().trim().optional(),
  imageModel: z.string().trim().optional(),
});

// 保存 LLM 配置到 settings 表（DB 优先、环境变量兜底，保存后立即生效）
export async function PATCH(req: NextRequest) {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const entries: [string, string][] = [];
  if (data.baseUrl !== undefined) entries.push([LLM_SETTING_KEYS.baseUrl, data.baseUrl]);
  if (data.apiKey !== undefined) entries.push([LLM_SETTING_KEYS.apiKey, data.apiKey]);
  if (data.model !== undefined) entries.push([LLM_SETTING_KEYS.model, data.model]);
  if (data.visionBaseUrl !== undefined) entries.push([VISION_SETTING_KEYS.baseUrl, data.visionBaseUrl]);
  if (data.visionApiKey !== undefined) entries.push([VISION_SETTING_KEYS.apiKey, data.visionApiKey]);
  if (data.visionModel !== undefined) entries.push([VISION_SETTING_KEYS.model, data.visionModel]);
  if (data.imageBaseUrl !== undefined) entries.push([IMAGE_SETTING_KEYS.baseUrl, data.imageBaseUrl]);
  if (data.imageApiKey !== undefined) entries.push([IMAGE_SETTING_KEYS.apiKey, data.imageApiKey]);
  if (data.imageModel !== undefined) entries.push([IMAGE_SETTING_KEYS.model, data.imageModel]);
  if (entries.length === 0) {
    return NextResponse.json({ error: "没有需要保存的字段" }, { status: 400 });
  }

  const db = getDb();
  const now = Date.now();
  db.transaction((tx) => {
    for (const [key, value] of entries) {
      tx.insert(settings)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
        .run();
    }
  });
  return NextResponse.json({ ok: true });
}

// 清除数据库中的 LLM 配置，回退到环境变量
export async function DELETE() {
  const db = getDb();
  db.delete(settings).where(inArray(settings.key, Object.values(LLM_SETTING_KEYS))).run();
  return NextResponse.json({ ok: true });
}
