import { describe, expect, it, beforeEach } from "vitest";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import {
  FEATURE_SETTING_KEYS,
  getFeatureFlags,
  isFeatureEnabled,
  isImageGenAvailable,
  isReasoningAvailable,
  setFeatureEnabled,
  type FeatureKey,
} from "@/lib/feature-flags";
import {
  IMAGE_SETTING_KEYS,
  REASONING_SETTING_KEYS,
  isImageGenConfigured,
  isReasoningConfigured,
} from "@/lib/llm-config";
import { CORRECTION_LEARNING_SETTING } from "@/lib/correction-learning";
import { isCorrectionLearningEnabled } from "@/lib/correction-learning";
import { buildSystemMessage } from "@/lib/ai/chat-context";
import { wipeData } from "../helpers/db";

const ALL: FeatureKey[] = ["handwriting", "imageGen", "mermaid", "reasoning"];

describe("功能开关", () => {
  beforeEach(() => wipeData());

  /* 判据：全新数据库首次启动时四项入口均不可见。
     这是本模块存在的全部理由——降低新用户的第一屏认知负担。 */
  it("全新数据库里四项一律关闭", () => {
    const db = getDb();
    for (const feature of ALL) expect(isFeatureEnabled(db, feature)).toBe(false);
    expect(getFeatureFlags(db)).toEqual({ handwriting: false, imageGen: false, mermaid: false, reasoning: false });
  });

  /* 默认值方向与「纠正即学习」相反，这里用一条对照测试把坑钉死：
     isCorrectionLearningEnabled 判的是 value !== "0"（无记录即开启），
     照抄那套写法会让四项功能在空库上全部默认开启，与判据正好相反。 */
  it("默认值方向与「纠正即学习」相反，不可照抄先例", () => {
    const db = getDb();
    expect(isCorrectionLearningEnabled(db)).toBe(true);
    expect(isFeatureEnabled(db, "mermaid")).toBe(false);
    expect(FEATURE_SETTING_KEYS.mermaid).not.toBe(CORRECTION_LEARNING_SETTING);
  });

  it("开启后立即生效，且互不牵连", () => {
    const db = getDb();
    setFeatureEnabled(db, "mermaid", true);
    expect(isFeatureEnabled(db, "mermaid")).toBe(true);
    for (const feature of ALL.filter((f) => f !== "mermaid")) {
      expect(isFeatureEnabled(db, feature)).toBe(false);
    }
  });

  it("开了还能关回去", () => {
    const db = getDb();
    setFeatureEnabled(db, "handwriting", true);
    setFeatureEnabled(db, "handwriting", false);
    expect(isFeatureEnabled(db, "handwriting")).toBe(false);
  });

  it("重复写入不产生第二行，键是主键", () => {
    const db = getDb();
    setFeatureEnabled(db, "imageGen", true);
    setFeatureEnabled(db, "imageGen", true);
    setFeatureEnabled(db, "imageGen", false);
    const rows = db.select().from(settings).all().filter((r) => r.key === FEATURE_SETTING_KEYS.imageGen);
    expect(rows).toHaveLength(1);
  });

  /* 只认 "1"。默认关闭的语义是「必须明确开启」，所以任何看起来像真的脏值
     （手工改库写成 "true"、旧版本遗留的空串）都按关闭处理，宁可少显示一个入口
     也不要在用户没开启的情况下把功能放出来。 */
  it.each(["true", "", "0", "yes", "2"])("非 \"1\" 的值一律视为关闭：%s", (raw) => {
    const db = getDb();
    const now = Date.now();
    db.insert(settings)
      .values({ key: FEATURE_SETTING_KEYS.reasoning, value: raw, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: raw, updatedAt: now } })
      .run();
    expect(isFeatureEnabled(db, "reasoning")).toBe(false);
  });

  it("getFeatureFlags 与逐项读取结果一致", () => {
    const db = getDb();
    setFeatureEnabled(db, "mermaid", true);
    setFeatureEnabled(db, "reasoning", true);
    const flags = getFeatureFlags(db);
    for (const feature of ALL) expect(flags[feature]).toBe(isFeatureEnabled(db, feature));
    expect(flags).toEqual({ handwriting: false, imageGen: false, mermaid: true, reasoning: true });
  });

  /* 四个键各自独立且不与既有设置键撞车：settings 是全局 KV，
     撞键会让开关与 LLM 配置互相覆盖。 */
  it("四个键互不重复", () => {
    const keys = Object.values(FEATURE_SETTING_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/* 生图与深度思考在开关之前就已经受「是否配置了对应模型」约束，新开关是其上的
   一层，两者是「与」的关系。把这层合成写成显式函数而不是散在各个调用点，
   是因为两个 chat 路由 + layout 三处都要问同一个问题，各写各的迟早会漏一处。 */
describe("功能开关与模型配置的合成", () => {
  beforeEach(() => wipeData());

  // 测试环境已注入 LLM_*，baseUrl 与 apiKey 会回落到文本模型，故只需补模型名
  function configureModel(key: string) {
    const now = Date.now();
    getDb().insert(settings)
      .values({ key, value: "some-model", updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: "some-model", updatedAt: now } })
      .run();
  }

  const truthTable: Array<[configured: boolean, enabled: boolean, available: boolean]> = [
    [true, true, true],    // 配了模型又开了开关，才真的可用
    [true, false, false],  // 配了模型但没开开关——新开关的作用就在这一行
    [false, true, false],  // 开了开关但没配模型——原有约束仍然拦得住
    [false, false, false],
  ];

  it.each(truthTable)("生图：配置=%s 开关=%s → 可用=%s", (configured, enabled, available) => {
    const db = getDb();
    if (configured) configureModel(IMAGE_SETTING_KEYS.model);
    setFeatureEnabled(db, "imageGen", enabled);
    expect(isImageGenConfigured()).toBe(configured);
    expect(isImageGenAvailable(db)).toBe(available);
  });

  it.each(truthTable)("深度思考：配置=%s 开关=%s → 可用=%s", (configured, enabled, available) => {
    const db = getDb();
    if (configured) configureModel(REASONING_SETTING_KEYS.model);
    setFeatureEnabled(db, "reasoning", enabled);
    expect(isReasoningConfigured()).toBe(configured);
    expect(isReasoningAvailable(db)).toBe(available);
  });
});

/* Mermaid 关掉之后，助手也不该再往笔记里写 mermaid 代码块：编辑器已经不渲染了，
   写进去只是一段没出图的源码，用户没开这功能却先收到了它的半成品。 */
describe("Mermaid 开关对系统提示词的影响", () => {
  beforeEach(() => wipeData());

  it("关闭时提示词不教模型画图", () => {
    expect(buildSystemMessage("global", "").system).not.toContain("mermaid");
  });

  it("开启后绘图指引回到提示词里", () => {
    setFeatureEnabled(getDb(), "mermaid", true);
    expect(buildSystemMessage("global", "").system).toContain("mermaid");
  });
});
