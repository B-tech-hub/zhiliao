import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { INBOX_TOPIC_ID, notes, tags, topics } from "@/db/schema";
import { chatJson } from "@/lib/llm";
import { replaceNoteTags } from "@/lib/notes";
import { refreshNoteFts } from "@/lib/search";

// 送入 LLM 的正文截断长度：分类/标题/标签对前文敏感度足够
const CONTENT_LIMIT = 4000;
// 超过该长度才生成摘要
const SUMMARY_MIN_LENGTH = 200;

// 校验从宽：长度超限不判失败，落库前在代码里截断
const resultSchema = z.object({
  topicId: z.string(),
  confidence: z.number().min(0).max(1).catch(0),
  title: z.string().catch(""),
  tags: z.array(z.string()).catch([]),
  summary: z.string().nullable().catch(null),
});

function confidenceThreshold(): number {
  const v = Number(process.env.AI_CONFIDENCE_THRESHOLD);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.6;
}

// 一次 LLM 调用完成：选主题 + 起标题 + 打标签 + 摘要
export async function processNote(db: DB, noteId: string): Promise<void> {
  const note = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
    .get();
  if (!note) return; // 笔记已被删除或在回收站，任务作废

  db.update(notes).set({ aiStatus: "processing" }).where(eq(notes.id, noteId)).run();

  const topicRows = db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .orderBy(asc(topics.sortOrder))
    .all();
  const tagRows = db.select({ name: tags.name }).from(tags).orderBy(asc(tags.name)).limit(100).all();

  const content =
    note.content.length > CONTENT_LIMIT ? note.content.slice(0, CONTENT_LIMIT) + "\n…（已截断）" : note.content;

  const raw = await chatJson([
    {
      role: "system",
      content:
        "你是个人知识库的笔记整理助手。根据笔记内容完成：选择主题、生成标题、提取标签、生成摘要。只输出 JSON，不要输出任何其他文字或代码块。",
    },
    {
      role: "user",
      content: [
        "## 现有主题列表（topicId 只能从中选择，不能新建）",
        JSON.stringify(topicRows),
        "",
        "## 笔记内容（Markdown）",
        content,
        "",
        "## 任务要求",
        `1. topicId：选最匹配的主题 id；把你的确定程度写入 confidence（0~1 小数）；没有合适主题时选 "${INBOX_TOPIC_ID}"。`,
        "2. title：不超过 20 字的中文短标题，概括核心内容，不要标点结尾。",
        `3. tags：2~5 个标签，每个 2~6 字，优先复用已有标签：${JSON.stringify(tagRows.map((t) => t.name))}`,
        `4. summary：笔记原文超过 ${SUMMARY_MIN_LENGTH} 字时给一句话摘要（不超过 50 字），否则为 null。`,
        "",
        "## 输出 JSON 格式",
        '{"topicId":"string","confidence":0.0,"title":"string","tags":["string"],"summary":"string 或 null"}',
      ].join("\n"),
    },
  ]);

  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`LLM 输出不符合预期结构: ${parsed.error.issues[0]?.message}`);
  }
  const result = parsed.data;

  // topicId 白名单校验：不在现有主题中一律归未分类
  const validTopicIds = new Set(topicRows.map((t) => t.id));
  let targetTopic = validTopicIds.has(result.topicId) ? result.topicId : INBOX_TOPIC_ID;
  if (result.confidence < confidenceThreshold()) {
    targetTopic = INBOX_TOPIC_ID;
  }

  // 回写前重读锁字段，用户手动改过的字段跳过；LLM 调用在途期间
  // 笔记可能已被移入回收站——此时放弃回写，避免改写用户看不到的内容
  const fresh = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
    .get();
  if (!fresh) return;

  db.transaction((tx) => {
    const patch: Partial<typeof notes.$inferInsert> = {
      aiStatus: "done",
      updatedAt: Date.now(),
    };
    if (!fresh.topicLocked) patch.topicId = targetTopic;
    if (!fresh.titleLocked && result.title.trim()) patch.title = result.title.trim().slice(0, 40);
    patch.summary =
      fresh.content.length >= SUMMARY_MIN_LENGTH && result.summary ? result.summary.slice(0, 100) : null;
    tx.update(notes).set(patch).where(eq(notes.id, noteId)).run();
    const cleanTags = result.tags.map((t) => t.trim()).filter((t) => t && t.length <= 20).slice(0, 5);
    if (!fresh.tagsLocked && cleanTags.length) {
      replaceNoteTags(tx as never, noteId, cleanTags);
    }
  });
  refreshNoteFts(db, noteId);
}

// 处理最终失败：留在原地（通常是未分类），标记 failed，标题回退为内容首行
export function markNoteFailed(db: DB, noteId: string): void {
  const note = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
    .get();
  if (!note) return;
  const patch: Partial<typeof notes.$inferInsert> = { aiStatus: "failed" };
  if (!note.title && !note.titleLocked) {
    const firstLine = note.content.split("\n").find((l) => l.trim());
    patch.title = (firstLine ?? "").replace(/^#+\s*/, "").slice(0, 40);
  }
  db.update(notes).set(patch).where(eq(notes.id, noteId)).run();
  refreshNoteFts(db, noteId);
}
