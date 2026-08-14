import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { INBOX_TOPIC_ID, notes, topics } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueueNoteProcess, getTagsForNotes } from "@/lib/notes";
import { refreshNoteFts } from "@/lib/search";

// 列表：?topicId=&cursor=&limit=，按 updated_at 倒序，cursor 为上一页最后一条的 updated_at
export async function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const topicId = sp.get("topicId");
  const cursor = Number(sp.get("cursor")) || null;
  const limit = Math.min(Number(sp.get("limit")) || 20, 100);

  const conds = [isNull(notes.deletedAt)];
  if (topicId) conds.push(eq(notes.topicId, topicId));
  if (cursor) conds.push(lt(notes.updatedAt, cursor));

  const rows = db
    .select()
    .from(notes)
    .where(and(...conds))
    .orderBy(desc(notes.updatedAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const tagMap = getTagsForNotes(db, page.map((n) => n.id));

  return NextResponse.json({
    notes: page.map((n) => ({ ...n, tags: tagMap.get(n.id) ?? [] })),
    nextCursor: hasMore ? page[page.length - 1].updatedAt : null,
  });
}

const createSchema = z.object({
  content: z.string().min(1, "内容不能为空"),
  topicId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
  }
  const db = getDb();
  const now = Date.now();
  const id = newId();

  // 指定了主题则视为用户手动归类（锁定主题），否则进未分类等 AI 处理
  let topicId = INBOX_TOPIC_ID;
  let topicLocked = 0;
  if (parsed.data.topicId) {
    const topic = db.select().from(topics).where(eq(topics.id, parsed.data.topicId)).get();
    if (!topic) return NextResponse.json({ error: "主题不存在" }, { status: 400 });
    topicId = topic.id;
    if (topic.id !== INBOX_TOPIC_ID) topicLocked = 1;
  }

  db.insert(notes)
    .values({
      id,
      topicId,
      title: "",
      content: parsed.data.content,
      aiStatus: "pending",
      topicLocked,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  refreshNoteFts(db, id);
  enqueueNoteProcess(db, id);

  return NextResponse.json({ id }, { status: 201 });
}
