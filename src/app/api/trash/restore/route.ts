import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { restoreNotes } from "@/lib/trash";

const bodySchema = z.object({
  noteIds: z.array(z.string()).min(1).max(200),
});

// 从回收站恢复：清除删除标记、重建搜索索引，被打断的 AI 整理自动重新入队
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const restored = restoreNotes(getDb(), parsed.data.noteIds);
  return NextResponse.json({ ok: true, restored });
}
