import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { notes, topics } from "@/db/schema";
import { makeExcerpt, searchNoteIds } from "@/lib/search";
import { getTagsForNotes } from "@/lib/notes";
import { defineTool } from "./types";

const schema = z.object({
  query: z.string().min(1).describe("搜索关键词，支持中文分词；多个词用空格分隔表示同时命中"),
  limit: z.number().int().min(1).max(20).optional().describe("返回条数上限，默认 8"),
});

export const searchNotesTool = defineTool({
  name: "search_notes",
  description:
    "在用户的知识库中按关键词搜索笔记，返回匹配笔记的 id、标题、所属主题与摘录。" +
    "回答任何与用户已有记录相关的问题前都应先搜索。不会返回回收站中的笔记。",
  schema,
  run: ({ query, limit }, { db }) => {
    const max = limit ?? 8;
    const { ids, terms } = searchNoteIds(query, max);
    if (ids.length === 0) {
      return { content: `没有找到与「${query}」相关的笔记。`, noteIds: [] };
    }

    const rows = db
      .select({
        id: notes.id,
        title: notes.title,
        summary: notes.summary,
        content: notes.content,
        updatedAt: notes.updatedAt,
        topicName: topics.name,
      })
      .from(notes)
      .innerJoin(topics, eq(notes.topicId, topics.id))
      .where(and(inArray(notes.id, ids), isNull(notes.deletedAt)))
      .all();

    // searchNoteIds 已按相关度排序，这里恢复该顺序（IN 查询不保证顺序）
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r) => r !== undefined);
    const tagMap = getTagsForNotes(db, ordered.map((r) => r.id));

    const lines = ordered.map((r) => {
      const tags = tagMap.get(r.id) ?? [];
      const excerpt = r.summary || makeExcerpt(r.content, terms);
      return [
        `- noteId: ${r.id}`,
        `  标题: ${r.title || "（无标题）"}`,
        `  主题: ${r.topicName}`,
        tags.length ? `  标签: ${tags.join("、")}` : "",
        `  摘录: ${excerpt}`,
      ]
        .filter(Boolean)
        .join("\n");
    });

    return {
      content: `找到 ${ordered.length} 条与「${query}」相关的笔记：\n${lines.join("\n")}`,
      noteIds: ordered.map((r) => r.id),
    };
  },
});
