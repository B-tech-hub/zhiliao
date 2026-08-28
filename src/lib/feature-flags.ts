import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { settings } from "@/db/schema";
import { isImageGenConfigured, isReasoningConfigured } from "@/lib/llm-config";

/* 四项非核心功能的开关。核心路径只有「记—找—用」三步，这四项在任何一个
   未来象限里都不改变胜负，却各自往第一屏塞了一个入口，所以从默认体验里挪出去。
   注意这是降级不是删除：已产生的数据（已转写的笔记、已生成的图、已存的思考过程）
   照常展示与导出，用户随时可以在设置页把入口要回来。 */
export const FEATURE_SETTING_KEYS = {
  handwriting: "feature_handwriting_enabled",
  imageGen: "feature_image_gen_enabled",
  mermaid: "feature_mermaid_enabled",
  reasoning: "feature_reasoning_enabled",
} as const;

export type FeatureKey = keyof typeof FEATURE_SETTING_KEYS;
export type FeatureFlags = Record<FeatureKey, boolean>;

const FEATURES = Object.keys(FEATURE_SETTING_KEYS) as FeatureKey[];
const ALL_KEYS: string[] = Object.values(FEATURE_SETTING_KEYS);

/* 只认 "1"，其余一切（无记录、空串、"true"、"0"）都是关。
   这与同在 settings 表里的「纠正即学习」方向相反——那个判的是 value !== "0"，
   无记录即开启。照抄它会让四项功能在空库上全部默认开启，与本模块的目的正好相反。 */
export function isFeatureEnabled(db: DB, feature: FeatureKey): boolean {
  return db.select().from(settings).where(eq(settings.key, FEATURE_SETTING_KEYS[feature])).get()?.value === "1";
}

// 一次取齐四项，供 layout 这类要把开关一路传给客户端组件的地方使用，避免四次查询
export function getFeatureFlags(db: DB): FeatureFlags {
  const enabled = new Set(
    db.select().from(settings).where(inArray(settings.key, ALL_KEYS)).all()
      .filter((row) => row.value === "1")
      .map((row) => row.key),
  );
  return Object.fromEntries(FEATURES.map((f) => [f, enabled.has(FEATURE_SETTING_KEYS[f])])) as FeatureFlags;
}

export function setFeatureEnabled(db: DB, feature: FeatureKey, enabled: boolean): void {
  const now = Date.now();
  const value = enabled ? "1" : "0";
  db.insert(settings)
    .values({ key: FEATURE_SETTING_KEYS[feature], value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
    .run();
}

/* 生图与深度思考在开关出现之前就已受「是否配置了对应模型」约束，新开关是其上的
   一层，两者是「与」。合成写在这里而不是散在调用点，是因为两个 chat 路由与
   layout 三处都要问同一个问题，各写各的迟早漏一处——漏在路由侧的后果尤其糟：
   界面上入口已经藏了，模型那边工具还照发，用户会收到一张自己从没要过的失败卡片。 */
export function isImageGenAvailable(db: DB): boolean {
  return isImageGenConfigured() && isFeatureEnabled(db, "imageGen");
}

export function isReasoningAvailable(db: DB): boolean {
  return isReasoningConfigured() && isFeatureEnabled(db, "reasoning");
}
