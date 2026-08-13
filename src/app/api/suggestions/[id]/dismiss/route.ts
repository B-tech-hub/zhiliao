import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { topicSuggestions } from "@/db/schema";

// 忽略建议
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const row = db.select().from(topicSuggestions).where(eq(topicSuggestions.id, id)).get();
  if (!row) return NextResponse.json({ error: "建议不存在" }, { status: 404 });
  db.update(topicSuggestions).set({ status: "dismissed" }).where(eq(topicSuggestions.id, id)).run();
  return NextResponse.json({ ok: true });
}
