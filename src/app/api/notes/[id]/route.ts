import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { NoteWriteError, updateNote } from "@/lib/note-write";
import { getTagsForNotes } from "@/lib/notes";
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
  transcriptionReviewStatus: z.enum(["unreviewed", "reviewed", "needs_review"]).optional(),
});

// 用户显式修改 title/topicId/tags 时置锁，AI 不再覆盖；修改 content 时重新入队 AI
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  try {
    // 写入路径统一走 note-write，与 AI 助手工具共用
    updateNote(getDb(), id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NoteWriteError) {
      return NextResponse.json(
        { error: e.message },
        { status: e.code === "not_found" ? 404 : 400 },
      );
    }
    throw e;
  }
}

// 删除 = 移入回收站（30 天后随每日清扫彻底删除），恢复入口在 设置 → 回收站
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const trashed = trashNotes(getDb(), [id]);
  if (trashed === 0) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
