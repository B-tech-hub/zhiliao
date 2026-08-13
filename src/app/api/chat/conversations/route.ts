import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations } from "@/db/schema";

export const dynamic = "force-dynamic";

// 按作用域列出会话
export async function GET(req: NextRequest) {
  const scopeType = req.nextUrl.searchParams.get("scopeType");
  const scopeId = req.nextUrl.searchParams.get("scopeId");
  if ((scopeType !== "note" && scopeType !== "topic") || !scopeId) {
    return NextResponse.json({ error: "缺少 scopeType/scopeId" }, { status: 400 });
  }
  const rows = getDb()
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(and(eq(conversations.scopeType, scopeType), eq(conversations.scopeId, scopeId)))
    .orderBy(desc(conversations.updatedAt))
    .all();
  return NextResponse.json({ conversations: rows });
}
