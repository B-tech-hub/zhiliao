import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

// 视觉模型只需要可读副本，不应把笔记中的原图重新编码或覆盖。
// 总量按压缩后字节控制，给 Base64 膨胀、聊天历史和代理头部留足余量。
export const MAX_VISION_IMAGES = 6;
export const MAX_VISION_IMAGE_BYTES = 700 * 1024;
export const MAX_VISION_TOTAL_BYTES = 2.5 * 1024 * 1024;

const START_MAX_EDGE = 1600;
const MIN_MAX_EDGE = 960;
const START_QUALITY = 88;
const MIN_QUALITY = 72;

export class VisionImageError extends Error {}

async function makeVisionCopy(source: Buffer): Promise<Buffer> {
  let maxEdge = START_MAX_EDGE;
  let quality = START_QUALITY;
  let output = Buffer.alloc(0);

  for (;;) {
    output = await sharp(source, { failOn: "warning" })
      .rotate()
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality, smartSubsample: true })
      .toBuffer();

    if (output.byteLength <= MAX_VISION_IMAGE_BYTES) return output;
    if (maxEdge <= MIN_MAX_EDGE && quality <= MIN_QUALITY) break;
    maxEdge = Math.max(MIN_MAX_EDGE, Math.floor(maxEdge * 0.8));
    quality = Math.max(MIN_QUALITY, quality - 5);
  }

  throw new VisionImageError("单张图片压缩后仍然过大，请缩小图片后重试");
}

export async function prepareVisionImageDataUrls(
  filenames: string[],
  uploadDir = process.env.UPLOAD_DIR || "./data/uploads",
): Promise<string[]> {
  const uniqueNames = [...new Set(filenames.map((name) => path.basename(name)))];
  if (uniqueNames.length > MAX_VISION_IMAGES) {
    throw new VisionImageError(`一次最多读取 ${MAX_VISION_IMAGES} 张图片，请减少图片后重试`);
  }

  const urls: string[] = [];
  let totalBytes = 0;
  for (const name of uniqueNames) {
    let source: Buffer;
    try {
      source = fs.readFileSync(path.join(uploadDir, name));
    } catch {
      continue;
    }

    const compressed = await makeVisionCopy(source);
    totalBytes += compressed.byteLength;
    if (totalBytes > MAX_VISION_TOTAL_BYTES) {
      throw new VisionImageError("图片总量过大，请减少图片后重试");
    }
    urls.push(`data:image/webp;base64,${compressed.toString("base64")}`);
  }

  if (urls.length === 0) {
    throw new VisionImageError("笔记中的图片文件不存在或无法读取");
  }
  return urls;
}
