import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import convert from "heic-convert";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { images } from "@/db/schema";
import { HEIC_MIMES, IMAGE_EXT_BY_MIME, getUploadDir, saveImage, sniffImageMime } from "@/lib/uploads";

const MAX_SIZE = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_SIZE) return NextResponse.json({ error: "图片不能超过 20MB" }, { status: 400 });
  const mime = sniffImageMime(buf);
  if (!mime || (!IMAGE_EXT_BY_MIME[mime] && !HEIC_MIMES.has(mime))) {
    return NextResponse.json({ error: "仅支持 PNG、JPEG、GIF、WebP 或 HEIC 图片" }, { status: 400 });
  }
  if (!HEIC_MIMES.has(mime)) {
    try {
      const meta = await sharp(buf).metadata();
      if ((meta.width ?? 0) * (meta.height ?? 0) > 40_000_000) return NextResponse.json({ error: "图片像素过高" }, { status: 400 });
    } catch { return NextResponse.json({ error: "图片格式无效" }, { status: 400 }); }
  }
  const noteId = (form.get("noteId") as string) || null;
  if (!HEIC_MIMES.has(mime)) return NextResponse.json({ url: saveImage(getDb(), buf, mime, noteId).url }, { status: 201 });
  const id = crypto.randomUUID();
  const displayFilename = `${id}.jpg`;
  const originalFilename = `${id}.heic`;
  const dir = getUploadDir();
  try {
    const display = Buffer.from(await convert({ buffer: buf, format: "JPEG", quality: 0.92 }));
    const meta = await sharp(display).metadata();
    if ((meta.width ?? 0) * (meta.height ?? 0) > 40_000_000) throw new Error("pixels");
    fs.writeFileSync(path.join(dir, displayFilename), display);
    fs.writeFileSync(path.join(dir, originalFilename), buf);
    getDb().insert(images).values({ id, noteId, filename: displayFilename, mime: "image/jpeg", size: display.byteLength, originalFilename, originalMime: mime, originalSize: buf.byteLength, createdAt: Date.now() }).run();
    return NextResponse.json({ url: `/api/images/${displayFilename}` }, { status: 201 });
  } catch {
    for (const name of [displayFilename, originalFilename]) { try { fs.unlinkSync(path.join(dir, name)); } catch {} }
    return NextResponse.json({ error: "HEIC 图片转换失败" }, { status: 400 });
  }
}
