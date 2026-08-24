import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { hybridSearchNoteIds, makeExcerpt } from "@/lib/search";
import { authenticateApiToken, getBearerToken } from "@/lib/api-token";

export async function GET(req: NextRequest) {
  if (!authenticateApiToken(getBearerToken(req), "knowledge:read")) return NextResponse.json({ error: "无效或无权限的 Token" }, { status: 401 });
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const topicId = sp.get("topicId");
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 20, 1), 50);
  const topicRows = db.select({ id: topics.id, name: topics.name }).from(topics).all();
  const topicName = new Map(topicRows.map((t) => [t.id, t.name]));
  let ids: string[];
  let terms: string[] = [];
  if (q) ({ ids, terms } = await hybridSearchNoteIds(q, limit));
  else ids = db.select({ id: notes.id }).from(notes).where(and(isNull(notes.deletedAt), topicId ? eq(notes.topicId, topicId) : undefined)).orderBy(desc(notes.updatedAt)).limit(limit).all().map((r) => r.id);
  const rows = db.select().from(notes).where(and(inArray(notes.id, ids), isNull(notes.deletedAt))).all();
  const tags = getTagsForNotes(db, ids);
  const byId = new Map(rows.map((n) => [n.id, n]));
  return NextResponse.json({ notes: ids.map((id) => byId.get(id)).filter(Boolean).filter((n) => !topicId || n!.topicId === topicId).map((n) => ({ id: n!.id, title: n!.title, summary: n!.summary, content: n!.content, excerpt: makeExcerpt(n!.content, terms), topicId: n!.topicId, topicName: topicName.get(n!.topicId) ?? "", tags: tags.get(n!.id) ?? [], createdAt: n!.createdAt, updatedAt: n!.updatedAt })) });
}
