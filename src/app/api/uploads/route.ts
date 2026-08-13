import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { images } from "@/db/schema";
import { newId } from "@/lib/ids";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function getUploadDir(): string {
  const dir = process.env.UPLOAD_DIR || "./data/uploads";
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 图片上传：multipart 表单，字段 file，可选 noteId
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "图片不能超过 5MB" }, { status: 400 });
  }
  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json({ error: "仅支持 png/jpg/gif/webp 图片" }, { status: 400 });
  }

  const id = newId();
  const filename = `${id}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(getUploadDir(), filename), buf);

  const noteId = (form.get("noteId") as string) || null;
  getDb()
    .insert(images)
    .values({ id, noteId, filename, mime: file.type, size: file.size, createdAt: Date.now() })
    .run();

  return NextResponse.json({ url: `/api/images/${filename}` }, { status: 201 });
}
