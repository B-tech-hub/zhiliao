import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { INBOX_TOPIC_ID, notes, topics } from "@/db/schema";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const topic = db.select().from(topics).where(eq(topics.id, id)).get();
  if (!topic) return NextResponse.json({ error: "主题不存在" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  if (topic.isSystem && parsed.data.name !== undefined) {
    return NextResponse.json({ error: "系统主题不能重命名" }, { status: 400 });
  }

  try {
    db.update(topics)
      .set({ ...parsed.data, updatedAt: Date.now() })
      .where(eq(topics.id, id))
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return NextResponse.json({ error: "已存在同名主题" }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const topic = db.select().from(topics).where(eq(topics.id, id)).get();
  if (!topic) return NextResponse.json({ error: "主题不存在" }, { status: 404 });
  if (topic.isSystem) {
    return NextResponse.json({ error: "“未分类”不能删除" }, { status: 400 });
  }

  // 事务内：笔记回落到未分类（并解除主题锁定，让 AI 之后可重新归类），再删主题
  db.transaction((tx) => {
    tx.update(notes)
      .set({ topicId: INBOX_TOPIC_ID, topicLocked: 0, updatedAt: Date.now() })
      .where(eq(notes.topicId, id))
      .run();
    tx.delete(topics).where(eq(topics.id, id)).run();
  });
  return NextResponse.json({ ok: true });
}
