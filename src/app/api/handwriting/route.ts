import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { createNote } from "@/lib/note-write";
import { enqueueHandwritingTranscribe } from "@/lib/notes";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { images } from "@/db/schema";
import { eq } from "drizzle-orm";

const schema = z.object({ filename: z.string().min(1), topicId: z.string().optional() });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "缺少图片文件名" }, { status: 400 });
  const db = getDb();
  /* 功能关闭时连转写任务都不建。只藏界面入口不够：这条路径会先建一条笔记再排队，
     绕过界面直接打过来就会在库里留下一条只有原图的笔记，等一个永远不会跑的转写。 */
  if (!isFeatureEnabled(db, "handwriting")) {
    return NextResponse.json({ error: "手写摄取未开启，可在设置页开启" }, { status: 403 });
  }
  if (!db.select().from(images).where(eq(images.filename, parsed.data.filename)).get()) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  const note = createNote(db, { content: `![手写原图](/api/images/${parsed.data.filename})`, topicId: parsed.data.topicId, deferAi: true });
  enqueueHandwritingTranscribe(db, note.id, parsed.data.filename, note.createdAt);
  return NextResponse.json({ id: note.id, status: "queued" }, { status: 202 });
}
