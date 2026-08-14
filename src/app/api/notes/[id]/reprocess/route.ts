import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { enqueueNoteProcess } from "@/lib/notes";

// AI 整理失败后手动重试：重置状态并重新入队
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const note = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .get();
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

  db.update(notes).set({ aiStatus: "pending" }).where(eq(notes.id, id)).run();
  enqueueNoteProcess(db, id);
  return NextResponse.json({ ok: true });
}
