import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { purgeNotes } from "@/lib/trash";

const bodySchema = z.object({
  noteIds: z.array(z.string()).min(1).max(200),
});

// 彻底删除：只对回收站内的笔记生效（purgeNotes 内部前置过滤），
// 连带清理关联图片与 AI 会话，此后仅存在于既有备份中（最多再保留 7 天）
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const purged = purgeNotes(getDb(), parsed.data.noteIds);
  return NextResponse.json({ ok: true, purged });
}
