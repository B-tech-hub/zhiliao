import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { aiJobs, notes } from "@/db/schema";
import { removeNoteFts } from "@/lib/search";

const bodySchema = z.object({
  noteIds: z.array(z.string()).min(1).max(200),
});

// 批量删除笔记：物理删除，note_tags 靠外键级联；FTS 与待处理 AI 任务需手动清理
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { noteIds } = parsed.data;
  const db = getDb();

  const existing = db
    .select({ id: notes.id })
    .from(notes)
    .where(inArray(notes.id, noteIds))
    .all()
    .map((r) => r.id);
  if (existing.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  db.transaction((tx) => {
    tx.delete(notes).where(inArray(notes.id, existing)).run();
    tx.delete(aiJobs).where(inArray(aiJobs.noteId, existing)).run();
    for (const id of existing) {
      removeNoteFts(id);
    }
  });
  return NextResponse.json({ ok: true, deleted: existing.length });
}
