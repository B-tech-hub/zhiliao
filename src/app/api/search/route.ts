import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { hybridSearchNoteIds, makeExcerpt } from "@/lib/search";

// 全文搜索：?q=关键词&topicId=可选；q 为空但指定了 topicId 时退化为「按主题浏览」
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const topicFilter = req.nextUrl.searchParams.get("topicId");
  if (!q && !topicFilter) return NextResponse.json({ results: [], terms: [] });

  const db = getDb();

  // 结果组装：两条分支共用同一套输出结构
  const topicRows = db.select({ id: topics.id, name: topics.name }).from(topics).all();
  const topicName = new Map(topicRows.map((t) => [t.id, t.name]));
  type NoteRow = typeof notes.$inferSelect;
  function toItems(rows: NoteRow[], terms: string[], tagMap: Map<string, string[]>) {
    return rows.map((n) => ({
      id: n.id,
      title: n.title || n.content.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 40) || "（空笔记）",
      excerpt: makeExcerpt(n.content, terms),
      topicId: n.topicId,
      topicName: topicName.get(n.topicId) ?? "",
      tags: tagMap.get(n.id) ?? [],
      updatedAt: n.updatedAt,
    }));
  }

  // 分支一：无关键词，直接列出该主题下最近的笔记
  if (!q) {
    const rows = db
      .select()
      .from(notes)
      .where(and(eq(notes.topicId, topicFilter!), isNull(notes.deletedAt)))
      .orderBy(desc(notes.updatedAt))
      .limit(50)
      .all();
    const tagMap = getTagsForNotes(db, rows.map((n) => n.id));
    return NextResponse.json({ results: toItems(rows, [], tagMap), terms: [] });
  }

  // 分支二：全文检索
  const search = await hybridSearchNoteIds(q, 50);
  const { ids, terms } = search;
  if (ids.length === 0) return NextResponse.json({ results: [], terms, staleEmbeddingCount: search.staleEmbeddingCount, vectorEnabled: search.vectorEnabled });

  // 回表时排除回收站：FTS 命中理论上不含已删笔记，此处是第二道防线
  const rows = db
    .select()
    .from(notes)
    .where(and(inArray(notes.id, ids), isNull(notes.deletedAt)))
    .all();
  const tagMap = getTagsForNotes(db, ids);
  const byId = new Map(rows.map((n) => [n.id, n]));

  // 按检索排序返回，可选按主题过滤
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .filter((n) => !topicFilter || n.topicId === topicFilter);

  return NextResponse.json({ results: toItems(ordered, terms, tagMap), terms, staleEmbeddingCount: search.staleEmbeddingCount, vectorEnabled: search.vectorEnabled });
}
