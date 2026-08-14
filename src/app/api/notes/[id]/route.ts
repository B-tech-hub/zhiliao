import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";
import { enqueueNoteProcess, getTagsForNotes, replaceNoteTags } from "@/lib/notes";
import { refreshNoteFts } from "@/lib/search";
import { trashNotes } from "@/lib/trash";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const note = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .get();
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  const tagMap = getTagsForNotes(db, [id]);
  return NextResponse.json({ note: { ...note, tags: tagMap.get(id) ?? [] } });
}

const patchSchema = z.object({
  content: z.string().min(1).optional(),
  title: z.string().max(100).optional(),
  topicId: z.string().optional(),
  tags: z.array(z.string()).max(10).optional(),
});

// 用户显式修改 title/topicId/tags 时置锁，AI 不再覆盖；修改 content 时重新入队 AI
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const note = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .get();
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const data = parsed.data;

  if (data.topicId !== undefined) {
    const topic = db.select().from(topics).where(eq(topics.id, data.topicId)).get();
    if (!topic) return NextResponse.json({ error: "主题不存在" }, { status: 400 });
  }

  const now = Date.now();
  db.transaction((tx) => {
    const patch: Partial<typeof notes.$inferInsert> = { updatedAt: now };
    if (data.content !== undefined) patch.content = data.content;
    if (data.title !== undefined) {
      patch.title = data.title;
      patch.titleLocked = 1;
    }
    if (data.topicId !== undefined) {
      patch.topicId = data.topicId;
      patch.topicLocked = 1;
    }
    tx.update(notes).set(patch).where(eq(notes.id, id)).run();
    if (data.tags !== undefined) {
      replaceNoteTags(tx as never, id, data.tags);
      tx.update(notes).set({ tagsLocked: 1 }).where(eq(notes.id, id)).run();
    }
  });
  refreshNoteFts(db, id);

  if (data.content !== undefined) {
    db.update(notes).set({ aiStatus: "pending" }).where(eq(notes.id, id)).run();
    enqueueNoteProcess(db, id);
  }
  return NextResponse.json({ ok: true });
}

// 删除 = 移入回收站（30 天后随每日清扫彻底删除），恢复入口在 设置 → 回收站
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const trashed = trashNotes(getDb(), [id]);
  if (trashed === 0) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
