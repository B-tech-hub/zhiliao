import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { createNote, NoteWriteError } from "@/lib/note-write";
import { getTagsForNotes } from "@/lib/notes";

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
  try {
    // 写入路径统一走 note-write，与 AI 助手工具共用（FTS 同步 / 主题锁 / AI 入队）
    const { id } = createNote(getDb(), parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    if (e instanceof NoteWriteError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
