// 图像生成的三条防线：张数封顶、图片类型嗅探、配置回落语义。
// 真实的生图请求不在这里测——它要真实 Key、真实计费，属于隔离实例的端到端验证。

import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { runTool, MAX_IMAGES_PER_MESSAGE, type ToolContext } from "@/lib/ai/tools";
import { getImageConfig, isImageGenConfigured, IMAGE_SETTING_KEYS } from "@/lib/llm-config";
import { settings } from "@/db/schema";
import { sniffImageMime } from "@/lib/uploads";
import { wipeData } from "../helpers/db";

beforeEach(() => {
  wipeData();
  for (const k of ["IMAGE_BASE_URL", "IMAGE_API_KEY", "IMAGE_MODEL", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]) {
    // 置 undefined 会写入字符串 "undefined"（v0.1.1 坑 #4），必须 delete
    delete process.env[k];
  }
});

function putSetting(key: string, value: string) {
  getDb().insert(settings).values({ key, value, updatedAt: Date.now() }).run();
}

describe("生图张数封顶", () => {
  const ctxWith = (remaining: number): ToolContext => ({
    db: getDb(),
    userUrls: [],
    imageBudget: { remaining },
  });

  it("额度耗尽时直接拒绝，且不发出任何请求", async () => {
    const ctx = ctxWith(0);
    const r = await runTool("generate_image", JSON.stringify({ prompt: "一只猫" }), ctx);
    expect(r.error).toBe(true);
    expect(r.content).toContain("额度已用完");
    // 未配置图像模型时若真发了请求，报错会是「未配置」而不是「额度已用完」
    expect(r.content).not.toContain("未配置");
  });

  /* 失败也扣额度。否则模型只要不断触发失败就能无限重试，
     而每次重试都是一次真实的付费请求——正是要防的那件事。 */
  it("生成失败同样扣额度，防止靠重试绕过上限", async () => {
    const ctx = ctxWith(MAX_IMAGES_PER_MESSAGE);
    // 未配置图像模型 → generateImage 抛 ImageGenError → 工具返回错误结果
    const first = await runTool("generate_image", JSON.stringify({ prompt: "猫" }), ctx);
    expect(first.error).toBe(true);
    expect(ctx.imageBudget?.remaining).toBe(MAX_IMAGES_PER_MESSAGE - 1);

    await runTool("generate_image", JSON.stringify({ prompt: "狗" }), ctx);
    expect(ctx.imageBudget?.remaining).toBe(0);

    const third = await runTool("generate_image", JSON.stringify({ prompt: "鸟" }), ctx);
    expect(third.content).toContain("额度已用完");
  });

  it("默认上限是 2 张", () => {
    expect(MAX_IMAGES_PER_MESSAGE).toBe(2);
  });
});

describe("图片类型嗅探", () => {
  /* 按魔数而非响应头判定。生成接口回传的 Content-Type 常常是
     application/octet-stream 或干脆缺失，照抄会存出打不开的文件。 */
  it("认得 png / jpeg / gif / webp", () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe(
      "image/png",
    );
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
    expect(sniffImageMime(Buffer.from("GIF89a....", "ascii"))).toBe("image/gif");

    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP", "ascii"),
    ]);
    expect(sniffImageMime(webp)).toBe("image/webp");
  });

  it("非图片与截断数据返回 null，不猜", () => {
    expect(sniffImageMime(Buffer.from("<html>not an image</html>", "ascii"))).toBeNull();
    expect(sniffImageMime(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
    // RIFF 但不是 WEBP（如 wav）不能误判
    const wav = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("WAVE", "ascii"),
    ]);
    expect(sniffImageMime(wav)).toBeNull();
  });
});

describe("图像配置回落", () => {
  it("接入点与 Key 回落文本模型，模型名不回落", () => {
    putSetting("llm_base_url", "https://text.example.com/v1");
    putSetting("llm_api_key", "sk-text");
    putSetting("llm_model", "text-model");

    const noModel = getImageConfig();
    expect(noModel.baseUrl).toBe("https://text.example.com/v1");
    expect(noModel.apiKey).toBe("sk-text");
    // 模型名不回落：否则会拿文本模型名去调生图接口，必然失败且报错莫名其妙
    expect(noModel.model).toBeNull();
    expect(noModel.sources.baseUrl).toBe("fallback");
    expect(isImageGenConfigured()).toBe(false);

    putSetting(IMAGE_SETTING_KEYS.model, "cogview-3");
    const withModel = getImageConfig();
    expect(withModel.model).toBe("cogview-3");
    expect(withModel.sources.model).toBe("db");
    expect(isImageGenConfigured()).toBe(true);
  });

  it("显式配置的接入点覆盖回落值", () => {
    putSetting("llm_base_url", "https://text.example.com/v1");
    putSetting("llm_api_key", "sk-text");
    putSetting(IMAGE_SETTING_KEYS.baseUrl, "https://image.example.com/v1");
    putSetting(IMAGE_SETTING_KEYS.model, "cogview-3");

    const cfg = getImageConfig();
    expect(cfg.baseUrl).toBe("https://image.example.com/v1");
    expect(cfg.sources.baseUrl).toBe("db");
    // Key 没单独配，仍回落
    expect(cfg.apiKey).toBe("sk-text");
    expect(cfg.sources.apiKey).toBe("fallback");
  });

  it("什么都没配时三项皆 none", () => {
    const cfg = getImageConfig();
    expect(cfg.model).toBeNull();
    expect(cfg.sources.baseUrl).toBe("none");
    expect(cfg.sources.apiKey).toBe("none");
    expect(cfg.sources.model).toBe("none");
    expect(isImageGenConfigured()).toBe(false);
  });
});
