import { z } from "zod";
import { NoteWriteError, createNote } from "@/lib/note-write";
import { ToolError, defineTool } from "./types";

const schema = z.object({
  content: z.string().min(1).describe("笔记正文，Markdown 格式"),
  topicId: z
    .string()
    .optional()
    .describe("主题 id，必须来自 list_topics 的返回；省略则放入「未分类」，由后台 AI 自动归类"),
});

export const createNoteTool = defineTool({
  name: "create_note",
  description:
    "在知识库中新建一条笔记。用于记录用户口述的新内容，不要用它来修改已有笔记。" +
    "新建后后台会自动生成标题、标签与摘要，无需你代劳。",
  schema,
  mutates: true,
  run: ({ content, topicId }, { db }) => {
    try {
      const { id, createdAt } = createNote(db, { content, topicId });
      return {
        content: `已创建笔记，noteId: ${id}。标题与标签将由后台自动生成。`,
        noteIds: [id],
        summary: `新建笔记「${content.trim().slice(0, 20)}」`,
        undo: { tool: "create_note", noteId: id, before: {}, afterUpdatedAt: createdAt },
      };
    } catch (e) {
      if (e instanceof NoteWriteError) throw new ToolError(e.message);
      throw e;
    }
  },
});
