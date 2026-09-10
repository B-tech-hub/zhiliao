import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { notes, topics } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { MAX_TOOL_RESULT_CHARS, ToolError, defineTool } from "./types";

// 正文按页读取，不扩大对话的工具结果预算。
const MAX_CONTENT_CHARS = 6000;
const MAX_METADATA_CHARS = 300;

// 偏移沿用 JS 字符串的 UTF-16 单位，分页不能拆开一个代理对。
function safeEnd(text: string, end: number): number {
  const previous = text.charCodeAt(end - 1);
  const current = text.charCodeAt(end);
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff
    ? end - 1
    : end;
}

function metadataPreview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_METADATA_CHARS
    ? `${line.slice(0, safeEnd(line, MAX_METADATA_CHARS - 1))}…`
    : line;
}

const schema = z.object({
  noteId: z.string().min(1).describe("笔记 id，通常来自 search_notes 的返回"),
  offset: z.number().int().nonnegative().optional()
    .describe("正文起始位置，按 UTF-16 单位计数，默认 0；续读时原样使用上次返回的 nextOffset"),
});

export const readNoteTool = defineTool({
  name: "read_note",
  description:
    "读取一条笔记的标题、主题、标签和一页正文，每页正文最多 6000 个 UTF-16 单位。" +
    "默认从头读取；nextOffset 不为 null 时，以它作为 offset 继续读同一笔记，直到找到所需内容或读完。" +
    "需要引用原文细节时使用；只想知道有哪些相关笔记时用 search_notes 即可。",
  schema,
  run: ({ noteId, offset = 0 }, { db, allowedNoteIds }) => {
    // 限域会话里越界读取直接拒绝，不透露该笔记是否存在
    if (allowedNoteIds && !allowedNoteIds.has(noteId)) {
      throw new ToolError(`笔记 ${noteId} 不在本次对话的来源集内，无法读取`);
    }
    const row = db
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.content,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
        topicName: topics.name,
      })
      .from(notes)
      .innerJoin(topics, eq(notes.topicId, topics.id))
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
      .get();
    if (!row) {
      throw new ToolError(`笔记 ${noteId} 不存在或已在回收站`);
    }
    if (offset > row.content.length) {
      throw new ToolError(`offset 超出正文长度 ${row.content.length}，请使用上次返回的 nextOffset`);
    }
    if (safeEnd(row.content, offset) !== offset) {
      throw new ToolError("offset 位于字符中间，请使用上次返回的 nextOffset");
    }

    const tags = getTagsForNotes(db, [noteId]).get(noteId) ?? [];
    const metadata = [
      `noteId: ${row.id}`,
      `offset: ${offset}`,
      `totalLength: ${row.content.length}`,
      `标题: ${metadataPreview(row.title) || "（无标题）"}`,
      `主题: ${metadataPreview(row.topicName)}`,
      `标签: ${tags.length ? metadataPreview(tags.join("、")) : "（无）"}`,
      `更新时间: ${new Date(row.updatedAt).toLocaleString("zh-CN")}`,
    ].join("\n");
    // 为指针的最大位数预留空间，避免外层截断正文后 nextOffset 却已经跳到下一页。
    const pointerChars = Math.max(4, String(row.content.length).length);
    const contentBudget = Math.min(
      MAX_CONTENT_CHARS,
      MAX_TOOL_RESULT_CHARS - metadata.length - "\nnextOffset: \n正文:\n".length - pointerChars,
    );
    if (contentBudget < 2) {
      throw new ToolError("笔记元信息过长，无法在单次读取预算内返回正文");
    }
    const end = safeEnd(row.content, Math.min(row.content.length, offset + contentBudget));
    const nextOffset = end < row.content.length ? end : null;

    return {
      content: `${metadata}\nnextOffset: ${nextOffset}\n正文:\n${row.content.slice(offset, end)}`,
      noteIds: [row.id],
    };
  },
});
