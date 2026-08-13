import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";

export const dynamic = "force-dynamic";

// 会话详情（含全部消息）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const conv = db.select().from(conversations).where(eq(conversations.id, id)).get();
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  const msgs = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt))
    .all();
  return NextResponse.json({ conversation: conv, messages: msgs });
}

// 删除会话（消息级联删除）
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getDb().delete(conversations).where(eq(conversations.id, id)).run();
  return NextResponse.json({ ok: true });
}
