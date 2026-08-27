import { isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { enqueueNoteEmbedding } from "@/lib/notes";
import { getEmbeddingConfig, isEmbeddingConfigured } from "@/lib/llm-config";

type Row = {
  embedding: Buffer | null;
  embeddingModel: string | null;
  embeddingChunkCount: number | null;
  embeddingUpdatedAt: number | null;
  updatedAt: number;
};

/* 向量落在哪一侧取决于笔记长短：短笔记在 notes.embedding，长笔记在 note_chunks
   （此时 notes.embedding 被刻意置空）。只看 embedding 列会把所有长笔记误报成缺失。
   过期一律按笔记计一次——多块笔记按块累加会让「3 条待补算」显示成「9 条」。 */
function hasVector(row: Row): boolean {
  return (row.embeddingChunkCount ?? 0) >= 2 || Boolean(row.embedding);
}

function isStale(row: Row, model: string | null): boolean {
  /* chunk_count 为 NULL 说明这条向量是分块上线前算的整篇向量——它可能本该切成多块，
     但从库里看不出来。一律列入待补算，否则存量长笔记永远享受不到分块，除非正文
     恰好被改过。计划 §2 已把「分块触发全量回填」计入成本，这里就是那次回填的入口。 */
  if (row.embeddingChunkCount === null) return true;
  return row.embeddingModel !== model || !row.embeddingUpdatedAt || row.embeddingUpdatedAt < row.updatedAt;
}

const SELECTION = {
  embedding: notes.embedding,
  embeddingModel: notes.embeddingModel,
  embeddingChunkCount: notes.embeddingChunkCount,
  embeddingUpdatedAt: notes.embeddingUpdatedAt,
  updatedAt: notes.updatedAt,
};

function counts() {
  const db = getDb();
  const cfg = getEmbeddingConfig();
  const rows = db.select(SELECTION).from(notes).where(isNull(notes.deletedAt)).all();
  return {
    missing: rows.filter((r) => !hasVector(r)).length,
    stale: rows.filter((r) => hasVector(r) && isStale(r, cfg.model)).length,
  };
}

export async function GET() {
  return NextResponse.json({ ...counts(), configured: isEmbeddingConfigured() });
}

export async function POST() {
  if (!isEmbeddingConfigured()) return NextResponse.json({ error: "Embedding 未配置" }, { status: 400 });
  const db = getDb();
  const cfg = getEmbeddingConfig();
  const rows = db.select({ id: notes.id, ...SELECTION }).from(notes).where(isNull(notes.deletedAt)).all();
  const targets = rows.filter((r) => !hasVector(r) || isStale(r, cfg.model));
  for (const row of targets) enqueueNoteEmbedding(db, row.id);
  return NextResponse.json({ queued: targets.length, ...counts() });
}
