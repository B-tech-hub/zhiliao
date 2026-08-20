import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { images, notes } from "@/db/schema";
import { getVisionConfig } from "@/lib/llm-config";
import { chatStream, type ChatContentPart } from "@/lib/llm";
import { prepareVisionImageDataUrls } from "@/lib/vision-images";
import { appendTranscriptionBlock, normalizeMathMarkdown } from "@/lib/math";
import { refreshNoteFts } from "@/lib/search";

export async function transcribeHandwriting(db: DB, noteId: string, filename: string, baseUpdatedAt?: number): Promise<"appended" | "candidate" | "ignored"> {
  const note = db.select().from(notes).where(and(eq(notes.id, noteId), isNull(notes.deletedAt))).get();
  if (!note) return "ignored";
  if (!db.select().from(images).where(eq(images.filename, filename)).get()) throw new Error("手写图片不存在");
  const cfg = getVisionConfig();
  if (!cfg.model || !cfg.baseUrl || !cfg.apiKey) throw new Error("未配置视觉模型");
  const [url] = await prepareVisionImageDataUrls([filename]);
  const content: ChatContentPart[] = [
    { type: "text", text: "请转写这张手写笔记。只返回 JSON 对象 {\"markdown\":\"...\",\"warnings\":[\"...\"]}。保留中文段落、列表、表格和数学公式；行内公式使用 $...$，块级公式使用 $$...$$。看不清的内容不要臆造，写入 warnings。" },
    { type: "image_url", image_url: { url } },
  ];
  let raw = "";
  for await (const chunk of chatStream([{ role: "user", content }], { ...cfg, timeoutMs: 120000 })) if (chunk.type === "text") raw += chunk.text;
  let parsed: { markdown?: string; warnings?: string[] };
  try { parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "")); } catch { throw new Error("视觉模型返回不是合法 JSON"); }
  if (!parsed.markdown?.trim()) throw new Error("视觉模型未返回转写正文");
  const normalized = normalizeMathMarkdown(parsed.markdown);
  const warnings = [...(parsed.warnings ?? []), ...normalized.warnings];
  const fresh = db.select().from(notes).where(and(eq(notes.id, noteId), isNull(notes.deletedAt))).get();
  if (!fresh) return "ignored";
  if (baseUpdatedAt !== undefined && fresh.updatedAt !== baseUpdatedAt) {
    const conflictWarnings = [...warnings, "转写期间正文已修改，结果已保存为候选稿，未写入正文"];
    db.update(notes).set({ transcriptionCandidate: normalized.markdown, transcriptionReviewStatus: "needs_review", transcriptionWarnings: JSON.stringify(conflictWarnings), updatedAt: Date.now() }).where(eq(notes.id, noteId)).run();
    return "candidate";
  }
  db.update(notes).set({ content: appendTranscriptionBlock(fresh.content, normalized.markdown, `/api/images/${filename}`), transcriptionCandidate: null, transcriptionReviewStatus: warnings.length ? "needs_review" : "unreviewed", transcriptionWarnings: warnings.length ? JSON.stringify(warnings) : null, aiStatus: "pending", updatedAt: Date.now() }).where(eq(notes.id, noteId)).run();
  refreshNoteFts(db, noteId);
  return "appended";
}
