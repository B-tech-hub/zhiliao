import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { notes, topics } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { ToolError, defineTool } from "./types";

// 单条笔记回灌上限：超长笔记会挤掉后续工具结果的预算
const MAX_CONTENT_CHARS = 6000;

const schema = z.object({
  noteId: z.string().min(1).describe("笔记 id，通常来自 search_notes 的返回"),
});

export const readNoteTool = defineTool({
  name: "read_note",
  description:
    "读取一条笔记的完整内容（标题、主题、标签、正文）。" +
    "需要引用原文细节时使用；只想知道有哪些相关笔记时用 search_notes 即可。",
  schema,
  run: ({ noteId }, { db }) => {
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

    const tags = getTagsForNotes(db, [noteId]).get(noteId) ?? [];
    const truncated = row.content.length > MAX_CONTENT_CHARS;
    const content = truncated ? `${row.content.slice(0, MAX_CONTENT_CHARS)}\n…（正文过长已截断）` : row.content;

    return {
      content: [
        `noteId: ${row.id}`,
        `标题: ${row.title || "（无标题）"}`,
        `主题: ${row.topicName}`,
        tags.length ? `标签: ${tags.join("、")}` : "标签: （无）",
        `更新时间: ${new Date(row.updatedAt).toLocaleString("zh-CN")}`,
        "正文:",
        content,
      ].join("\n"),
      noteIds: [row.id],
    };
  },
});
