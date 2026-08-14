import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";

const bodySchema = z.object({
  noteIds: z.array(z.string()).min(1).max(200),
  topicId: z.string(),
});

// 批量移动笔记到指定主题（视为用户手动归类，锁定主题）；回收站笔记不可被移动
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const db = getDb();
  const topic = db.select().from(topics).where(eq(topics.id, parsed.data.topicId)).get();
  if (!topic) return NextResponse.json({ error: "主题不存在" }, { status: 400 });

  db.update(notes)
    .set({ topicId: topic.id, topicLocked: topic.isSystem ? 0 : 1, updatedAt: Date.now() })
    .where(and(inArray(notes.id, parsed.data.noteIds), isNull(notes.deletedAt)))
    .run();
  return NextResponse.json({ ok: true });
}
