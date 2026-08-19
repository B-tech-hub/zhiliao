import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { updateNote } from "@/lib/note-write";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const note = db.select().from(notes).where(and(eq(notes.id, id), isNull(notes.deletedAt))).get();
  if (!note?.transcriptionCandidate) return NextResponse.json({ error: "没有可接受的候选稿" }, { status: 404 });
  updateNote(db, id, { content: `${note.content.trimEnd()}\n\n> 手写转写候选稿（待核对）\n\n${note.transcriptionCandidate.trim()}` });
  db.update(notes).set({ transcriptionCandidate: null, transcriptionReviewStatus: "unreviewed", transcriptionWarnings: null }).where(eq(notes.id, id)).run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const result = db.update(notes).set({ transcriptionCandidate: null, transcriptionReviewStatus: "reviewed", transcriptionWarnings: null }).where(and(eq(notes.id, id), isNull(notes.deletedAt))).run();
  if (!result.changes) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
