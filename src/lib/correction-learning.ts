import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { correctionExamples, notes, settings } from "@/db/schema";
import { newId } from "@/lib/ids";

export type CorrectionField = "topic" | "title" | "tags";
export const CORRECTION_LEARNING_SETTING = "correction_learning_enabled";
const MAX_EXAMPLES = 3;

export function isCorrectionLearningEnabled(db: DB): boolean {
  return db.select().from(settings).where(eq(settings.key, CORRECTION_LEARNING_SETTING)).get()?.value !== "0";
}

export function recordCorrection(db: DB, noteId: string, field: CorrectionField, beforeValue: string, afterValue: string): void {
  if (!beforeValue.trim() || !afterValue.trim() || beforeValue === afterValue) return;
  const note = db.select({ content: notes.content }).from(notes).where(eq(notes.id, noteId)).get();
  if (!note) return;
  db.insert(correctionExamples).values({ id: newId(), field, beforeValue, afterValue, context: note.content.slice(0, 240), createdAt: Date.now() }).run();
}

export function getCorrectionExamples(db: DB, field: CorrectionField) {
  return db.select().from(correctionExamples).where(and(eq(correctionExamples.field, field), eq(correctionExamples.enabled, 1))).orderBy(desc(correctionExamples.createdAt)).limit(MAX_EXAMPLES).all();
}

export function renderCorrectionHints(db: DB): string {
  if (!isCorrectionLearningEnabled(db)) return "";
  const groups = (["topic", "title", "tags"] as CorrectionField[]).flatMap((field) => {
    const rows = getCorrectionExamples(db, field);
    return rows.length ? [`${field}:\n${rows.map((r) => `- ${r.beforeValue} -> ${r.afterValue}`).join("\n")}`] : [];
  });
  return groups.length ? `\n\n以下是用户过去的纠正样例，仅作风格参考，不要机械复制：\n${groups.join("\n")}` : "";
}
