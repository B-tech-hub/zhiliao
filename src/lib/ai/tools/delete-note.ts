import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { notes } from "@/db/schema";
import { trashNotes } from "@/lib/trash";
import { ToolError, defineTool } from "./types";

const schema = z.object({
  noteId: z.string().min(1).describe("要删除的笔记 id"),
});

/* 唯一需要用户确认的工具。删除本身是可恢复的（进回收站，30 天后才彻底清除），
   但它是助手动作里唯一会让内容从用户视野中消失的，误删的心理成本远高于其它操作。 */
export const deleteNoteTool = defineTool({
  name: "delete_note",
  description:
    "把一条笔记移入回收站（30 天内可恢复）。执行前会请求用户确认。" +
    "只在用户明确要求删除时调用。",
  schema,
  mutates: true,
  requiresConfirm: true,
  run: ({ noteId }, { db }) => {
    const note = db
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
      .get();
    if (!note) throw new ToolError(`笔记 ${noteId} 不存在或已在回收站`);

    const count = trashNotes(db, [noteId]);
    if (count === 0) throw new ToolError(`笔记 ${noteId} 删除失败`);

    return {
      content: `已把笔记 ${noteId}「${note.title || "（无标题）"}」移入回收站。`,
      noteIds: [noteId],
      summary: `删除「${note.title || "（无标题）"}」`,
      undo: {
        tool: "delete_note",
        noteId,
        before: {},
        // trashNotes 刻意不改 updatedAt（保持真实编辑时间），
        // 所以乐观锁基准沿用删除前的值
        afterUpdatedAt: note.updatedAt,
      },
    };
  },
});
