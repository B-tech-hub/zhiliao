import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { notes } from "@/db/schema";
import { NoteWriteError, updateNote } from "@/lib/note-write";
import { getTagsForNotes } from "@/lib/notes";
import { ToolError, defineTool } from "./types";

const schema = z.object({
  noteId: z.string().min(1).describe("要修改的笔记 id"),
  topicId: z.string().optional().describe("新的主题 id，必须来自 list_topics 的返回"),
  title: z.string().max(100).optional().describe("新的标题"),
  tags: z.array(z.string()).max(10).optional().describe("新的标签数组，会整体替换原有标签"),
});

/* 改动的字段会被置「锁」，后台 AI 不再覆盖。这是刻意的：
   否则助手刚归好类，几秒后 AI 自动整理又改回去，在用户看来就是操作被吞了。
   代价是这条笔记此后不再享受 AI 自动整理，撤销时需要连锁位一起恢复。 */
export const updateMetaTool = defineTool({
  name: "update_meta",
  description:
    "修改笔记的主题、标题或标签（三者可任选其一或组合）。不能用它修改正文。" +
    "注意：被修改过的字段之后不再被后台 AI 自动调整。",
  schema,
  mutates: true,
  run: ({ noteId, topicId, title, tags }, { db }) => {
    if (topicId === undefined && title === undefined && tags === undefined) {
      throw new ToolError("至少要指定 topicId、title、tags 其中一项");
    }
    const note = db
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
      .get();
    if (!note) throw new ToolError(`笔记 ${noteId} 不存在或已在回收站`);

    const beforeTags = getTagsForNotes(db, [noteId]).get(noteId) ?? [];
    try {
      const { updatedAt } = updateNote(db, noteId, { topicId, title, tags });
      const changed = [
        topicId !== undefined ? "主题" : "",
        title !== undefined ? "标题" : "",
        tags !== undefined ? "标签" : "",
      ].filter(Boolean);
      return {
        content: `已更新笔记 ${noteId} 的${changed.join("、")}。`,
        noteIds: [noteId],
        summary: `修改「${note.title || "（无标题）"}」的${changed.join("、")}`,
        undo: {
          tool: "update_meta",
          noteId,
          // 锁位一并快照：撤销时若只恢复值不恢复锁，笔记会永久失去 AI 自动整理
          before: {
            topicId: note.topicId,
            title: note.title,
            tags: beforeTags,
            topicLocked: note.topicLocked,
            titleLocked: note.titleLocked,
            tagsLocked: note.tagsLocked,
          },
          afterUpdatedAt: updatedAt,
        },
      };
    } catch (e) {
      if (e instanceof NoteWriteError) throw new ToolError(e.message);
      throw e;
    }
  },
});
