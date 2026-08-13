import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { images } from "@/db/schema";

// 从磁盘卷读取图片；文件名为服务端生成的 cuid，不存在路径穿越空间，但仍做规范化校验
export async function GET(_req: NextRequest, ctx: { params: Promise<{ filename: string }> }) {
  const { filename } = await ctx.params;
  if (!/^[a-z0-9]+\.(png|jpg|gif|webp)$/.test(filename)) {
    return NextResponse.json({ error: "非法文件名" }, { status: 400 });
  }
  const record = getDb().select().from(images).where(eq(images.filename, filename)).get();
  if (!record) return NextResponse.json({ error: "图片不存在" }, { status: 404 });

  const dir = process.env.UPLOAD_DIR || "./data/uploads";
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "图片文件丢失" }, { status: 404 });
  }
  const buf = fs.readFileSync(filePath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": record.mime,
      "Content-Length": String(buf.length),
      // 文件名含内容 id 且不可变，可长期缓存
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
