import { NextRequest, NextResponse } from "next/server";
import { asc, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { topics } from "@/db/schema";
import { newId } from "@/lib/ids";

// 主题列表（含笔记计数），未分类靠 sort_order=-1 置顶
export async function GET() {
  const db = getDb();
  const rows = db
    .select({
      id: topics.id,
      name: topics.name,
      isSystem: topics.isSystem,
      sortOrder: topics.sortOrder,
      noteCount: sql<number>`(SELECT COUNT(*) FROM notes WHERE notes.topic_id = topics.id AND notes.deleted_at IS NULL)`,
    })
    .from(topics)
    .orderBy(asc(topics.sortOrder), asc(topics.createdAt))
    .all();
  return NextResponse.json({ topics: rows });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(30) });

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "主题名不能为空，且不超过 30 字" }, { status: 400 });
  }
  const db = getDb();
  const now = Date.now();
  const id = newId();
  try {
    db.insert(topics)
      .values({ id, name: parsed.data.name, isSystem: 0, sortOrder: 0, createdAt: now, updatedAt: now })
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return NextResponse.json({ error: "已存在同名主题" }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ id }, { status: 201 });
}
