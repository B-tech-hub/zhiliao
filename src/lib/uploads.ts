// 图片落盘的唯一入口：上传接口与 AI 生图工具共用同一条路径，
// 保证文件名规则、images 表记录、目录创建这三件事不会有人漏做。
// 另开一条写入路径的代价是孤儿清扫会漏掉它——images 表没有记录的文件永远不会被回收。

import fs from "node:fs";
import path from "node:path";
import type { DB } from "@/db";
import { images } from "@/db/schema";
import { newId } from "@/lib/ids";

// mime 到扩展名。白名单同时充当「允许存哪些格式」的判据
export const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
export const HEIC_MIMES = new Set(["image/heic", "image/heif"]);

export function getUploadDir(): string {
  const dir = process.env.UPLOAD_DIR || "./data/uploads";
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* 按魔数判断图片类型。生成接口回传的 Content-Type 常常是 application/octet-stream
   或干脆缺失，照抄会存出一个扩展名错误、浏览器打不开的文件。 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) return "image/gif";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii").toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "mif1"].includes(brand)) return "image/heic";
  }
  return null;
}

/* 落盘 + 入库。noteId 允许为空：上传时正文尚未保存、AI 生成的图尚未被采纳，
   两者都靠 trash.ts 的 24 小时上传宽限期兜底——未被任何笔记正文引用且过了
   宽限期的图才会被每日清扫回收，所以「生成了没用」的图不需要额外处理。 */
export function saveImage(
  db: DB,
  buf: Buffer,
  mime: string,
  noteId: string | null = null,
): { id: string; filename: string; url: string } {
  const ext = IMAGE_EXT_BY_MIME[mime];
  if (!ext) throw new Error(`不支持的图片类型：${mime}`);
  const id = newId();
  const filename = `${id}.${ext}`;
  fs.writeFileSync(path.join(getUploadDir(), filename), buf);
  db.insert(images)
    .values({ id, noteId, filename, mime, size: buf.byteLength, createdAt: Date.now() })
    .run();
  return { id, filename, url: `/api/images/${filename}` };
}
