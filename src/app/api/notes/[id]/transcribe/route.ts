import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { images, notes } from "@/db/schema";
import { enqueueHandwritingTranscribe } from "@/lib/notes";
import { updateNote } from "@/lib/note-write";

const schema = z.object({ filename: z.string().min(1) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "缺少图片文件名" }, { status: 400 });
  const db = getDb();
  const note = db.select().from(notes).where(and(eq(notes.id, id), isNull(notes.deletedAt))).get();
  const image = db.select().from(images).where(eq(images.filename, parsed.data.filename)).get();
  if (!note || !image) return NextResponse.json({ error: "笔记或图片不存在" }, { status: 404 });
  if (!note.content.includes(`/api/images/${parsed.data.filename}`)) {
    updateNote(db, id, { content: `${note.content.trimEnd()}\n\n![手写原图](/api/images/${parsed.data.filename})` });
  }
  const fresh = db.select().from(notes).where(eq(notes.id, id)).get();
  enqueueHandwritingTranscribe(db, id, parsed.data.filename, fresh?.updatedAt ?? note.updatedAt);
  return NextResponse.json({ ok: true, status: "queued" }, { status: 202 });
}
