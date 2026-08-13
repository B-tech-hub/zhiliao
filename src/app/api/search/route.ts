import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { makeExcerpt, searchNoteIds } from "@/lib/search";

// 全文搜索：?q=关键词&topicId=可选
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const topicFilter = req.nextUrl.searchParams.get("topicId");
  if (!q) return NextResponse.json({ results: [], terms: [] });

  const db = getDb();
  const { ids, terms } = searchNoteIds(q, 50);
  if (ids.length === 0) return NextResponse.json({ results: [], terms });

  const rows = db.select().from(notes).where(inArray(notes.id, ids)).all();
  const topicRows = db.select({ id: topics.id, name: topics.name }).from(topics).all();
  const topicName = new Map(topicRows.map((t) => [t.id, t.name]));
  const tagMap = getTagsForNotes(db, ids);
  const byId = new Map(rows.map((n) => [n.id, n]));

  // 按检索排序返回，可选按主题过滤
  const results = ids
    .map((id) => byId.get(id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .filter((n) => !topicFilter || n.topicId === topicFilter)
    .map((n) => ({
      id: n.id,
      title: n.title || n.content.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 40) || "（空笔记）",
      excerpt: makeExcerpt(n.content, terms),
      topicId: n.topicId,
      topicName: topicName.get(n.topicId) ?? "",
      tags: tagMap.get(n.id) ?? [],
      updatedAt: n.updatedAt,
    }));

  return NextResponse.json({ results, terms });
}
