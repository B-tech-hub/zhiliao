import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { noteChunks, notes } from "@/db/schema";
import { refreshNoteFts } from "@/lib/search";
import { buildNoteChunks, buildNoteEmbeddingText, embedTexts } from "@/lib/ai/embedding";
import { newId } from "@/lib/ids";
import { insertNote } from "./db";

/* 真实供应商验收的共用装载逻辑。抽出来是为了让 T0 回归与 T1 分块验收共享同一套
   写入实现——两份各写一遍必然漂移，而「写入方式与 worker.ts 一致」正是这类
   验收可信的前提。

   CHUNK_MODE：off = 整篇一个向量（T0 原路径）；title = 分块且每块注入标题；
   notitle = 分块但不注入标题。 */
export type ChunkMode = "off" | "title" | "notitle";

// 笔记 id 取文件名前两位，便于在报告里对上号
export const fixtureNoteId = (prefix: string) => `n-${prefix}`;

export function importFixtureNotes(dirs: string[]): string[] {
  const ids: string[] = [];
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      const raw = readFileSync(path.join(dir, file), "utf8");
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      const front = m ? m[1] : "";
      const body = (m ? m[2] : raw).trim();
      const title = front.match(/^title:\s*(.+)$/m)?.[1].trim() ?? file.replace(/\.md$/, "");
      const id = fixtureNoteId(file.slice(0, 2));
      insertNote(id, body, { title });
      refreshNoteFts(getDb(), id);
      ids.push(id);
    }
  }
  return ids;
}

/* 真实补算：所有笔记的所有块合并成尽量少的批量请求，写入方式与 worker.ts 的
   embed_note 分支一致（多块进 note_chunks 且 notes.embedding 置空）。 */
export async function backfillFixtures(
  ids: string[],
  mode: ChunkMode,
): Promise<{ dim: number; total: number; shape: string }> {
  const plans = ids.map((id) => {
    const note = getDb().select().from(notes).where(eq(notes.id, id)).get()!;
    const chunks = mode === "off" ? [] : buildNoteChunks(note, { injectTitle: mode === "title" });
    const multi = chunks.length >= 2;
    return { id, texts: multi ? chunks : [buildNoteEmbeddingText(note)], multi };
  });

  const vectors = await embedTexts(plans.flatMap((p) => p.texts));
  const model = process.env.EMBEDDING_MODEL!;
  let cursor = 0;
  for (const plan of plans) {
    const own = vectors.slice(cursor, cursor + plan.texts.length);
    cursor += plan.texts.length;
    const note = getDb().select().from(notes).where(eq(notes.id, plan.id)).get()!;
    const meta = { embeddingModel: model, embeddingDim: own[0].length, embeddingUpdatedAt: note.updatedAt };
    if (plan.multi) {
      getDb().update(notes).set({ embedding: null, embeddingChunkCount: own.length, ...meta }).where(eq(notes.id, plan.id)).run();
      getDb()
        .insert(noteChunks)
        .values(plan.texts.map((text, i) => ({
          id: newId(),
          noteId: plan.id,
          chunkIndex: i,
          text,
          embedding: Buffer.from(new Float32Array(own[i]).buffer),
          ...meta,
        })))
        .run();
    } else {
      getDb()
        .update(notes)
        .set({ embedding: Buffer.from(new Float32Array(own[0]).buffer), embeddingChunkCount: 1, ...meta })
        .where(eq(notes.id, plan.id))
        .run();
    }
  }
  return {
    dim: vectors[0].length,
    total: vectors.length,
    shape: plans.map((p) => `${p.id.slice(-2)}:${p.texts.length}`).join(" "),
  };
}

export function noteTitle(id: string): string {
  return getDb().select({ t: notes.title }).from(notes).where(eq(notes.id, id)).get()?.t ?? "?";
}
