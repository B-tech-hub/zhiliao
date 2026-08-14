import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { notes } from "@/db/schema";
import { NoteWriteError, updateNote } from "@/lib/note-write";
import { ToolError, defineTool, fingerprint } from "./types";

const schema = z.object({
  noteId: z.string().min(1).describe("要追加内容的笔记 id"),
  text: z.string().min(1).describe("追加到正文末尾的内容，Markdown 格式"),
});

/* 只提供追加、不提供正文覆盖：ADR-0007 明确不做版本历史，
   覆盖正文是唯一不可恢复的操作，因此从工具层就不给这个能力。 */
export const appendToNoteTool = defineTool({
  name: "append_to_note",
  description:
    "把一段内容追加到已有笔记的正文末尾。" +
    "无法替换或删除笔记中已有的正文——需要改写时请告知用户手动编辑。",
  schema,
  mutates: true,
  run: ({ noteId, text }, { db }) => {
    const note = db
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
      .get();
    if (!note) throw new ToolError(`笔记 ${noteId} 不存在或已在回收站`);

    const appended = `${note.content.trimEnd()}\n\n${text.trim()}`;
    try {
      const { updatedAt } = updateNote(db, noteId, { content: appended });
      return {
        content: `已向笔记 ${noteId} 追加内容。`,
        noteIds: [noteId],
        summary: `向「${note.title || "（无标题）"}」追加内容`,
        undo: {
          tool: "append_to_note",
          noteId,
          // 撤销 = 把正文截回追加前的长度
          before: { contentLength: note.content.trimEnd().length, aiStatus: note.aiStatus },
          afterUpdatedAt: updatedAt,
          // 唯一会毁掉用户编辑的反向操作，指纹比对必须严格：
          // 正文一旦与助手写入时不同，就不能再截断
          afterFingerprint: fingerprint(appended),
        },
      };
    } catch (e) {
      if (e instanceof NoteWriteError) throw new ToolError(e.message);
      throw e;
    }
  },
});
