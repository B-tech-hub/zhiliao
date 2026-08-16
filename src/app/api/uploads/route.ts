import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { IMAGE_EXT_BY_MIME, saveImage } from "@/lib/uploads";

const MAX_SIZE = 5 * 1024 * 1024;

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
  if (!IMAGE_EXT_BY_MIME[file.type]) {
    return NextResponse.json({ error: "仅支持 png/jpg/gif/webp 图片" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const noteId = (form.get("noteId") as string) || null;
  // 落盘与入库统一走 uploads.ts，与 AI 生图工具共用同一条路径
  const { url } = saveImage(getDb(), buf, file.type, noteId);

  return NextResponse.json({ url }, { status: 201 });
}
