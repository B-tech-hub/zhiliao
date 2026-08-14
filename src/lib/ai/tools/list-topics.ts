import { z } from "zod";
import { listTopicsWithCounts } from "@/lib/topics";
import { defineTool } from "./types";

const schema = z.object({});

export const listTopicsTool = defineTool({
  name: "list_topics",
  description:
    "列出知识库中的全部主题及各自的笔记数量。" +
    "在把笔记归类到某个主题之前，必须先用本工具确认主题 id——主题不能凭空创建。",
  schema,
  run: (_args, { db }) => {
    const rows = listTopicsWithCounts(db);
    const lines = rows.map(
      (t) => `- topicId: ${t.id}｜名称: ${t.name}｜笔记数: ${t.noteCount}${t.isSystem ? "｜系统主题" : ""}`,
    );
    return { content: `共 ${rows.length} 个主题：\n${lines.join("\n")}` };
  },
});
