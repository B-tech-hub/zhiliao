import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { INBOX_TOPIC_ID, aiJobs, notes, topicSuggestions, topics } from "@/db/schema";
import { chatJson } from "@/lib/llm";
import { newId } from "@/lib/ids";
import { getTagsForNotes } from "@/lib/notes";
import { z } from "zod";

// 自动触发条件：未分类笔记数达到阈值，且距上次生成建议超过冷却时间
const MIN_INBOX_NOTES = 8;
const COOLDOWN_MS = 24 * 3600 * 1000;
// 每个建议至少覆盖的笔记数
const MIN_CLUSTER_SIZE = 3;

// 校验从宽：字段超长在清洗阶段截断，不整体判失败
const suggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string(),
        reason: z.string().catch(""),
        noteIds: z.array(z.string()).catch([]),
        existingTopicId: z.string().nullable().optional().catch(null),
      }),
    )
    .catch([]),
});

export function maybeEnqueueSuggestTopics(db: DB) {
  const inboxCount =
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(notes)
      .where(and(eq(notes.topicId, INBOX_TOPIC_ID), isNull(notes.deletedAt)))
      .get()?.c ?? 0;
  if (inboxCount < MIN_INBOX_NOTES) return;

  const lastSuggestion = db
    .select({ createdAt: topicSuggestions.createdAt })
    .from(topicSuggestions)
    .orderBy(desc(topicSuggestions.createdAt))
    .limit(1)
    .get();
  if (lastSuggestion && Date.now() - lastSuggestion.createdAt < COOLDOWN_MS) return;

  enqueueSuggestTopics(db);
}

// 入队聚类任务（已有未完成的则跳过）
export function enqueueSuggestTopics(db: DB) {
  const existing = db
    .select({ id: aiJobs.id })
    .from(aiJobs)
    .where(and(eq(aiJobs.type, "suggest_topics"), inArray(aiJobs.status, ["pending", "running"])))
    .get();
  if (existing) return;
  const now = Date.now();
  db.insert(aiJobs)
    .values({ id: newId(), noteId: null, type: "suggest_topics", status: "pending", runAfter: now, createdAt: now, updatedAt: now })
    .run();
}

// 一次 LLM 调用完成聚类：输入未分类笔记概要 + 现有主题名，输出最多 3 个建议
export async function runSuggestTopics(db: DB): Promise<void> {
  const inboxNotes = db
    .select({ id: notes.id, title: notes.title, content: notes.content })
    .from(notes)
    .where(and(eq(notes.topicId, INBOX_TOPIC_ID), isNull(notes.deletedAt)))
    .orderBy(desc(notes.updatedAt))
    .limit(50)
    .all();
  if (inboxNotes.length < MIN_CLUSTER_SIZE) return;

  const tagMap = getTagsForNotes(db, inboxNotes.map((n) => n.id));
  const topicRows = db.select({ id: topics.id, name: topics.name }).from(topics).where(eq(topics.isSystem, 0)).all();

  const digest = inboxNotes.map((n) => ({
    id: n.id,
    title: n.title || undefined,
    tags: tagMap.get(n.id) ?? undefined,
    excerpt: n.content.replace(/\s+/g, " ").slice(0, 120),
  }));

  const raw = await chatJson([
    {
      role: "system",
      content:
        "你是个人知识库的整理助手。请从“未分类”笔记中找出可以形成新主题的聚类。只输出 JSON，不要输出任何其他文字或代码块。",
    },
    {
      role: "user",
      content: [
        "## 现有主题（避免建议与它们语义重复的新主题）",
        JSON.stringify(topicRows),
        "",
        "## 未分类笔记概要",
        JSON.stringify(digest),
        "",
        "## 任务要求",
        `1. 找出至少 ${MIN_CLUSTER_SIZE} 条笔记构成的主题聚类，最多给 3 个建议，按把握从高到低排序。`,
        "2. name：主题名，2~8 字中文，粒度与现有主题相当。",
        "3. reason：一句话说明为什么这些笔记属于同一主题。",
        "4. noteIds：属于该聚类的笔记 id（只能取自上面的列表）。",
        '5. 如果某个聚类其实应归入现有主题，请把该主题的 id 写入 existingTopicId（此时 name 写现有主题名）；否则 existingTopicId 为 null。',
        "6. 找不到合适聚类时输出 {\"suggestions\":[]}。",
        "",
        "## 输出 JSON 格式",
        '{"suggestions":[{"name":"string","reason":"string","noteIds":["id"],"existingTopicId":"string 或 null"}]}',
      ].join("\n"),
    },
  ]);

  const parsed = suggestionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`聚类输出不符合预期结构: ${parsed.error.issues[0]?.message}`);
  }

  // 过滤：noteIds 必须真实存在于未分类；existingTopicId 必须真实存在；聚类太小的丢弃
  const validNoteIds = new Set(inboxNotes.map((n) => n.id));
  const validTopicIds = new Set(topicRows.map((t) => t.id));
  const cleaned = parsed.data.suggestions
    .map((s) => ({
      name: s.name.trim().slice(0, 20),
      reason: s.reason.trim().slice(0, 100),
      noteIds: [...new Set(s.noteIds.filter((id) => validNoteIds.has(id)))],
      existingTopicId: s.existingTopicId && validTopicIds.has(s.existingTopicId) ? s.existingTopicId : null,
    }))
    .filter((s) => s.name && s.noteIds.length >= MIN_CLUSTER_SIZE)
    .slice(0, 3);

  // 生成新建议前作废旧的 pending 建议
  db.transaction((tx) => {
    tx.update(topicSuggestions)
      .set({ status: "dismissed" })
      .where(eq(topicSuggestions.status, "pending"))
      .run();
    if (cleaned.length > 0) {
      tx.insert(topicSuggestions)
        .values({ id: newId(), payload: JSON.stringify({ suggestions: cleaned }), status: "pending", createdAt: Date.now() })
        .run();
    }
  });
}
