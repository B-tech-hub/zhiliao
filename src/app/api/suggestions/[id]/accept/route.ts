import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { notes, topicSuggestions, topics } from "@/db/schema";
import { newId } from "@/lib/ids";

const bodySchema = z.object({
  // 建议在 payload 中的下标
  index: z.number().int().min(0),
  // 用户勾选后保留的笔记 id（可剔除个别）
  noteIds: z.array(z.string()).min(1),
});

// 采纳建议：新建主题（或并入现有主题）+ 批量迁移笔记并锁定
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const row = db.select().from(topicSuggestions).where(eq(topicSuggestions.id, id)).get();
  if (!row || row.status !== "pending") {
    return NextResponse.json({ error: "建议不存在或已处理" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }

  const payload = JSON.parse(row.payload) as {
    suggestions: { name: string; reason: string; noteIds: string[]; existingTopicId: string | null }[];
  };
  const suggestion = payload.suggestions[parsed.data.index];
  if (!suggestion) return NextResponse.json({ error: "建议项不存在" }, { status: 400 });

  // 只迁移仍在未分类中的笔记，且必须属于该建议
  const allowed = new Set(suggestion.noteIds);
  const targetNoteIds = parsed.data.noteIds.filter((n) => allowed.has(n));
  if (targetNoteIds.length === 0) {
    return NextResponse.json({ error: "没有可迁移的笔记" }, { status: 400 });
  }

  let topicId = suggestion.existingTopicId;
  const now = Date.now();
  try {
    db.transaction((tx) => {
      if (!topicId) {
        const existing = tx.select().from(topics).where(eq(topics.name, suggestion.name)).get();
        if (existing) {
          topicId = existing.id;
        } else {
          topicId = newId();
          tx.insert(topics)
            .values({ id: topicId, name: suggestion.name, isSystem: 0, sortOrder: 0, createdAt: now, updatedAt: now })
            .run();
        }
      }
      tx.update(notes)
        .set({ topicId: topicId!, topicLocked: 1, updatedAt: now })
        .where(inArray(notes.id, targetNoteIds))
        .run();
      // 该建议整体标记已处理（其余建议项一并失效，避免笔记归属冲突）
      tx.update(topicSuggestions).set({ status: "accepted" }).where(eq(topicSuggestions.id, id)).run();
    });
  } catch (e) {
    return NextResponse.json({ error: `采纳失败: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }

  // 迁出后未分类若仍有存量，后续可再次生成建议
  return NextResponse.json({ ok: true, topicId });
}
