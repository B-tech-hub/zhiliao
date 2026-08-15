import { NextResponse } from "next/server";
import { desc, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, conversationSources, notes, topics } from "@/db/schema";

export const dynamic = "force-dynamic";

/* 列表条数上限。原先按 scope 过滤天然限量，改成全局列表后会话只增不减，
   一个用了一年的库轻松上千条。100 条足够翻到「上周聊的那次」。 */
const MAX_CONVERSATIONS = 100;

/* 列出会话，按最近更新倒序。
   不再按 scope 过滤：助手已是全局的，笔记/主题降级为可摘除的上下文附件，
   若仍按附件把历史切成互不可见的若干份，用户在首页一条历史都看不到。 */
export async function GET() {
  const db = getDb();
  const rows = db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
      scopeType: conversations.scopeType,
      scopeId: conversations.scopeId,
    })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt))
    .limit(MAX_CONVERSATIONS)
    .all();

  /* scope 标签供列表显示「围绕 XX」。查笔记时不排除回收站里的——
     笔记还能恢复，会话也还在，此时把标签抹成空白只会让人以为记错了。 */
  const noteIds = rows.filter((r) => r.scopeType === "note").map((r) => r.scopeId);
  const topicIds = rows.filter((r) => r.scopeType === "topic").map((r) => r.scopeId);
  const labels = new Map<string, string>();
  if (noteIds.length > 0) {
    for (const n of db
      .select({ id: notes.id, title: notes.title })
      .from(notes)
      .where(inArray(notes.id, noteIds))
      .all()) {
      labels.set(`note:${n.id}`, n.title || "（无标题笔记）");
    }
  }
  if (topicIds.length > 0) {
    for (const t of db
      .select({ id: topics.id, name: topics.name })
      .from(topics)
      .where(inArray(topics.id, topicIds))
      .all()) {
      labels.set(`topic:${t.id}`, t.name);
    }
  }

  /* 来源问答的 scopeId 是空串，标签取来源条数——
     否则它在列表里和普通对话长得一模一样，用户分不出哪次是接地问答。 */
  const sourceConvIds = rows.filter((r) => r.scopeType === "sources").map((r) => r.id);
  const sourceCounts = new Map<string, number>();
  if (sourceConvIds.length > 0) {
    for (const s of db
      .select({
        conversationId: conversationSources.conversationId,
        n: sql<number>`COUNT(*)`,
      })
      .from(conversationSources)
      .where(inArray(conversationSources.conversationId, sourceConvIds))
      .groupBy(conversationSources.conversationId)
      .all()) {
      sourceCounts.set(s.conversationId, s.n);
    }
  }

  return NextResponse.json({
    conversations: rows.map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updatedAt,
      scopeType: r.scopeType,
      // 对象已被彻底删除时留空，前端只显示会话标题
      scopeLabel:
        r.scopeType === "sources"
          ? `来源问答（${sourceCounts.get(r.id) ?? 0} 个来源）`
          : labels.get(`${r.scopeType}:${r.scopeId}`),
    })),
  });
}
