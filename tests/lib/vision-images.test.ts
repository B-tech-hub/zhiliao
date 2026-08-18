import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_VISION_IMAGES,
  MAX_VISION_TOTAL_BYTES,
  prepareVisionImageDataUrls,
  VisionImageError,
} from "@/lib/vision-images";

const dirs: string[] = [];

async function fixture(name = "sample.png"): Promise<{ dir: string; name: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-vision-"));
  dirs.push(dir);
  await sharp({
    create: { width: 1200, height: 1600, channels: 3, background: "white" },
  })
    .png()
    .toFile(path.join(dir, name));
  return { dir, name };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("prepareVisionImageDataUrls", () => {
  it("生成仅供视觉请求使用的 WebP Data URL", async () => {
    const { dir, name } = await fixture();
    const urls = await prepareVisionImageDataUrls([name], dir);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^data:image\/webp;base64,/);
    const payloadBytes = Buffer.from(urls[0].split(",")[1], "base64").byteLength;
    expect(payloadBytes).toBeLessThan(MAX_VISION_TOTAL_BYTES);
    expect(fs.existsSync(path.join(dir, name))).toBe(true);
  });

  it("同一文件被正文重复引用时只发送一次", async () => {
    const { dir, name } = await fixture();
    await expect(prepareVisionImageDataUrls([name, name], dir)).resolves.toHaveLength(1);
  });

  it("图片数量超限时在调用模型前给出明确错误", async () => {
    const names = Array.from({ length: MAX_VISION_IMAGES + 1 }, (_, index) => `${index}.png`);
    await expect(prepareVisionImageDataUrls(names, "missing")).rejects.toBeInstanceOf(VisionImageError);
  });

  it("图片文件全部丢失时不给视觉模型发送空请求", async () => {
    await expect(prepareVisionImageDataUrls(["missing.png"], "missing")).rejects.toThrow(
      "图片文件不存在或无法读取",
    );
  });
});
