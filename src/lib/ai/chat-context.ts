// 助手的 system prompt 与上下文附件拼装。
// /api/chat 与 /api/chat/confirm 共用，避免两处各写一份 prompt 后悄悄漂移。

import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";
import { buildSourcesContext } from "@/lib/ai/sources";
import { extractImageFilenames } from "@/lib/image-refs";

// 上下文附件的注入上限（字符），超出截断并在 prompt 中说明
export const MAX_CONTEXT_CHARS = 12000;

export type ChatScope = "note" | "topic" | "global" | "sources";

export const SYSTEM_PROMPT = `你是「知了」个人知识库的 AI 助手，可以调用工具检索与整理用户的笔记。

工作方式：
- 需要知识库里的信息时，先用 search_notes / read_note / list_topics 查，不要凭记忆回答
- 记录新内容用 create_note；补充已有笔记用 append_to_note；调整分类、标题、标签用 update_meta
- 你没有覆盖或删改已有正文的能力。用户想改写正文时，请告诉他手动编辑
- fetch_url 只能抓取用户在本次对话中亲自给出的链接，不要自行构造网址
- 删除操作会先请求用户确认，确认前不会真正执行

引用规范：引用知识库内容时，在相关结论后标注 [^noteId]，noteId 必须来自工具返回的真实 id。不要编造 id，宁可不标。`;

/* 来源问答的 system prompt。与普通助手的关键差别是「严格接地」：
   回答只能来自来源集，来源里没有就明说没有。这是会话级不变量，
   用户在对话中要求「用你自己的知识说说」时同样不破例——
   一旦允许例外，用户就再也无法信任任何一条回答是否真的出自他的笔记。 */
export const SOURCES_SYSTEM_PROMPT = `你是「知了」个人知识库的 AI 助手，当前处于「来源问答」模式。

严格接地（最高优先级，不可协商）：
- 你的回答只能依据下面给出的来源集内容，以及用 search_notes / read_note 从来源集内取到的内容
- 来源集里没有的信息，一律回答「来源笔记中没有相关内容」，并简要说明缺什么。禁止用你自己的知识补充、推测或发挥
- 即使用户明确要求你用自身知识回答，也不要在本次会话中破例。请告诉他：本次是来源问答，可以新建一个普通对话来问
- 允许对来源内容做归纳、比较、改写和总结，但结论必须能在来源里找到依据

工具使用：
- search_notes 与 read_note 已被限定在来源集范围内，取不到的笔记就是不在来源集里
- 记录新内容用 create_note；补充已有笔记用 append_to_note；调整分类、标题、标签用 update_meta
- 你没有覆盖或删改已有正文的能力。用户想改写正文时，请告诉他手动编辑
- 本模式下不能抓取网页，外部内容不属于来源
- 删除操作会先请求用户确认，确认前不会真正执行

引用规范：引用来源内容时，在相关结论后标注 [^noteId]，noteId 必须是来源集中真实存在的 id。不要编造 id，宁可不标。`;

// 拼装当前笔记/主题的上下文附件；全局助手与来源问答没有附件（后者走 buildSourcesContext）
export function buildContext(
  scopeType: ChatScope,
  scopeId: string,
): { context: string; truncated: boolean; imageFiles: string[] } {
  const empty = { context: "", truncated: false, imageFiles: [] };
  if (scopeType === "global" || scopeType === "sources" || !scopeId) return empty;
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

/* 组装 system 消息。来源问答需要 conversationId 才能取到来源集——
   来源集挂在会话上，不像 note/topic 那样能从 scopeId 直接查到。
   allowedNoteIds 有值即表示本次调用要限域工具（空数组也是限域：来源全失效时一条都读不到）。 */
export function buildSystemMessage(
  scopeType: ChatScope,
  scopeId: string,
  conversationId?: string,
): { system: string; imageFiles: string[]; allowedNoteIds?: string[]; sourcesMode?: "full" | "digest" | "empty" } {
  if (scopeType === "sources") {
    const { context, allowedNoteIds, mode } = buildSourcesContext(getDb(), conversationId ?? "");
    const body =
      mode === "empty"
        ? "当前来源集为空（可能来源笔记都已删除或移入回收站）。请告诉用户来源集里没有可用内容，建议他重新选择来源。"
        : context;
    return {
      system: `${SOURCES_SYSTEM_PROMPT}\n\n---\n来源集：\n${body}`,
      imageFiles: [],
      allowedNoteIds,
      sourcesMode: mode,
    };
  }

  const { context, truncated, imageFiles } = buildContext(scopeType, scopeId);
  if (!context) return { system: SYSTEM_PROMPT, imageFiles };
  const label = scopeType === "note" ? "笔记" : "主题";
  const note = truncated ? "（内容过长已截断）" : "";
  return {
    system: `${SYSTEM_PROMPT}\n\n---\n用户当前正在查看的${label}${note}：\n${context}`,
    imageFiles,
  };
}
