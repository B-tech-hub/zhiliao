import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { createNote } from "@/lib/note-write";
import { enqueueHandwritingTranscribe } from "@/lib/notes";
import { images } from "@/db/schema";
import { eq } from "drizzle-orm";

const schema = z.object({ filename: z.string().min(1), topicId: z.string().optional() });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "缺少图片文件名" }, { status: 400 });
  const db = getDb();
  if (!db.select().from(images).where(eq(images.filename, parsed.data.filename)).get()) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  const note = createNote(db, { content: `![手写原图](/api/images/${parsed.data.filename})`, topicId: parsed.data.topicId, deferAi: true });
  enqueueHandwritingTranscribe(db, note.id, parsed.data.filename, note.createdAt);
  return NextResponse.json({ id: note.id, status: "queued" }, { status: 202 });
}
