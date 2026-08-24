import { isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { enqueueNoteEmbedding } from "@/lib/notes";
import { getEmbeddingConfig, isEmbeddingConfigured } from "@/lib/llm-config";

function counts() {
  const db = getDb();
  const cfg = getEmbeddingConfig();
  const rows = db.select({ embedding: notes.embedding, embeddingModel: notes.embeddingModel, embeddingUpdatedAt: notes.embeddingUpdatedAt, updatedAt: notes.updatedAt }).from(notes).where(isNull(notes.deletedAt)).all();
  const missing = rows.filter((r) => !r.embedding).length;
  const stale = rows.filter((r) => Boolean(r.embedding) && (r.embeddingModel !== cfg.model || !r.embeddingUpdatedAt || r.embeddingUpdatedAt < r.updatedAt)).length;
  return { missing, stale };
}

export async function GET() {
  return NextResponse.json({ ...counts(), configured: isEmbeddingConfigured() });
}

export async function POST() {
  if (!isEmbeddingConfigured()) return NextResponse.json({ error: "Embedding 未配置" }, { status: 400 });
  const db = getDb();
  const cfg = getEmbeddingConfig();
  const rows = db.select({ id: notes.id, embedding: notes.embedding, embeddingModel: notes.embeddingModel, embeddingUpdatedAt: notes.embeddingUpdatedAt, updatedAt: notes.updatedAt }).from(notes).where(isNull(notes.deletedAt)).all();
  const targets = rows.filter((r) => !r.embedding || r.embeddingModel !== cfg.model || !r.embeddingUpdatedAt || r.embeddingUpdatedAt < r.updatedAt);
  for (const row of targets) enqueueNoteEmbedding(db, row.id);
  return NextResponse.json({ queued: targets.length, ...counts() });
}
