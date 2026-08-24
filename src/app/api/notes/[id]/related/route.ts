import { NextRequest, NextResponse } from "next/server";
import { and, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { hybridSearchNoteIds, makeExcerpt } from "@/lib/search";
import { chatJson } from "@/lib/llm";
import { isLlmConfigured } from "@/lib/llm";

const bodySchema = z.object({ content: z.string().min(20).max(5000) });

// 编辑器侧栏的相关笔记：向量只做候选召回，冲突必须由模型引用候选 noteId 判断。
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ results: [], conflicts: [] });

  const db = getDb();
  const search = await hybridSearchNoteIds(parsed.data.content.slice(0, 2000), 8);
  const ids = search.ids.filter((candidateId) => candidateId !== id);
  if (ids.length === 0) return NextResponse.json({ results: [], conflicts: [], vectorEnabled: search.vectorEnabled });

  const rows = db.select().from(notes).where(and(inArray(notes.id, ids), isNull(notes.deletedAt))).all();
  const tagMap = getTagsForNotes(db, ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const results = ids.map((candidateId) => byId.get(candidateId)).filter((row): row is NonNullable<typeof row> => Boolean(row)).map((row) => ({
    id: row.id,
    title: row.title || "（无标题笔记）",
    excerpt: makeExcerpt(row.content, search.terms),
    tags: tagMap.get(row.id) ?? [],
    updatedAt: row.updatedAt,
  }));

  let conflicts: { noteId: string; reason: string }[] = [];
  if (isLlmConfigured() && results.length > 0) {
    try {
      const candidateText = results.map((item) => `noteId=${item.id}\n标题：${item.title}\n摘录：${item.excerpt}`).join("\n\n");
      const judged = await chatJson([
        { role: "system", content: "你是个人知识库冲突检测器。只判断候选笔记与当前草稿是否存在明确相反、矛盾或互斥结论。只返回 JSON：{\"conflicts\":[{\"noteId\":\"候选中的真实ID\",\"reason\":\"不超过60字的中文理由\"}]}。没有冲突返回空数组。禁止编造 noteId。" },
        { role: "user", content: `当前草稿：\n${parsed.data.content.slice(0, 2000)}\n\n候选笔记：\n${candidateText}` },
      ]);
      const allowed = new Set(results.map((item) => item.id));
      const raw = (judged as { conflicts?: unknown } | null)?.conflicts;
      if (Array.isArray(raw)) {
        conflicts = raw.filter((item): item is { noteId: string; reason: string } => Boolean(item && typeof item === "object" && typeof (item as { noteId?: unknown }).noteId === "string" && allowed.has((item as { noteId: string }).noteId) && typeof (item as { reason?: unknown }).reason === "string")).map((item) => ({ noteId: item.noteId, reason: item.reason.slice(0, 120) }));
      }
    } catch (error) {
      console.warn("[related-notes] 冲突判断失败，保留相关笔记结果:", error instanceof Error ? error.message : error);
    }
  }
  return NextResponse.json({ results, conflicts, vectorEnabled: search.vectorEnabled, staleEmbeddingCount: search.staleEmbeddingCount });
}
