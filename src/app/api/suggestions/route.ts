import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { topicSuggestions } from "@/db/schema";

// 当前待处理的主题建议
export async function GET() {
  const db = getDb();
  const row = db
    .select()
    .from(topicSuggestions)
    .where(eq(topicSuggestions.status, "pending"))
    .orderBy(desc(topicSuggestions.createdAt))
    .limit(1)
    .get();
  if (!row) return NextResponse.json({ suggestion: null });
  return NextResponse.json({
    suggestion: { id: row.id, createdAt: row.createdAt, ...JSON.parse(row.payload) },
  });
}
