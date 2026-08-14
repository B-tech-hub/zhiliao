// 助手的 system prompt 与上下文附件拼装。
// /api/chat 与 /api/chat/confirm 共用，避免两处各写一份 prompt 后悄悄漂移。

import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";
import { extractImageFilenames } from "@/lib/image-refs";

// 上下文附件的注入上限（字符），超出截断并在 prompt 中说明
export const MAX_CONTEXT_CHARS = 12000;

export type ChatScope = "note" | "topic" | "global";

export const SYSTEM_PROMPT = `你是「知了」个人知识库的 AI 助手，可以调用工具检索与整理用户的笔记。

工作方式：
- 需要知识库里的信息时，先用 search_notes / read_note / list_topics 查，不要凭记忆回答
- 记录新内容用 create_note；补充已有笔记用 append_to_note；调整分类、标题、标签用 update_meta
- 你没有覆盖或删改已有正文的能力。用户想改写正文时，请告诉他手动编辑
- fetch_url 只能抓取用户在本次对话中亲自给出的链接，不要自行构造网址
- 删除操作会先请求用户确认，确认前不会真正执行

引用规范：引用知识库内容时，在相关结论后标注 [^noteId]，noteId 必须来自工具返回的真实 id。不要编造 id，宁可不标。`;

// 拼装当前笔记/主题的上下文附件；全局助手没有附件
export function buildContext(
  scopeType: ChatScope,
  scopeId: string,
): { context: string; truncated: boolean; imageFiles: string[] } {
  const empty = { context: "", truncated: false, imageFiles: [] };
  if (scopeType === "global" || !scopeId) return empty;
  const db = getDb();

  if (scopeType === "note") {
    const note = db
      .select()
      .from(notes)
      .where(and(eq(notes.id, scopeId), isNull(notes.deletedAt)))
      .get();
    if (!note) return empty;
    const full = `# ${note.title || "（无标题笔记）"}\n\n${note.content}`;
    const truncated = full.length > MAX_CONTEXT_CHARS;
    // 提取笔记中引用的本地图片文件名，供视觉模型读取
    const imageFiles = extractImageFilenames(note.content);
    return { context: truncated ? full.slice(0, MAX_CONTEXT_CHARS) : full, truncated, imageFiles };
  }

  const topic = db.select().from(topics).where(eq(topics.id, scopeId)).get();
  if (!topic) return empty;
  const rows = db
    .select({ title: notes.title, summary: notes.summary, content: notes.content })
    .from(notes)
    .where(and(eq(notes.topicId, scopeId), isNull(notes.deletedAt)))
    .orderBy(desc(notes.updatedAt))
    .all();
  let context = `主题：${topic.name}\n共 ${rows.length} 条笔记：\n\n`;
  let truncated = false;
  for (const n of rows) {
    const piece = `- ${n.title || "（无标题）"}：${n.summary || n.content.slice(0, 200).replace(/\n/g, " ")}\n`;
    if (context.length + piece.length > MAX_CONTEXT_CHARS) {
      truncated = true;
      break;
    }
    context += piece;
  }
  return { context, truncated, imageFiles: [] };
}

export function buildSystemMessage(
  scopeType: ChatScope,
  scopeId: string,
): { system: string; imageFiles: string[] } {
  const { context, truncated, imageFiles } = buildContext(scopeType, scopeId);
  if (!context) return { system: SYSTEM_PROMPT, imageFiles };
  const label = scopeType === "note" ? "笔记" : "主题";
  const note = truncated ? "（内容过长已截断）" : "";
  return {
    system: `${SYSTEM_PROMPT}\n\n---\n用户当前正在查看的${label}${note}：\n${context}`,
    imageFiles,
  };
}
