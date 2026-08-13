import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { enqueueSuggestTopics } from "@/lib/ai/suggest-topics";

// 手动触发“让 AI 帮我整理”：入队聚类任务
export async function POST() {
  const db = getDb();
  enqueueSuggestTopics(db);
  (globalThis as { __kbWorkerKick?: () => void }).__kbWorkerKick?.();
  return NextResponse.json({ ok: true });
}
