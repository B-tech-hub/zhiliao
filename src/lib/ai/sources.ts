// 来源问答的来源集：读写、展开与上下文拼装。
// 来源集只存引用（笔记 id / 主题 id），提问时现查——
// 主题是「活引用」，之后往该主题新增的笔记会自动进入来源范围。

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { conversationSources, notes, topics } from "@/db/schema";

// 来源全文注入 system 的上限（字符）。超出改注入来源清单，
// 完整内容交给限域后的 search_notes / read_note 按需取
export const MAX_SOURCES_CHARS = 12000;
// 清单模式下每条笔记的摘要长度
const DIGEST_CHARS = 200;

export interface SourceRef {
  type: "note" | "topic";
  id: string;
}

// 展示用的来源：带标题与状态。missing 表示对象已被彻底删除，
// deleted 表示笔记在回收站（内容不进 prompt，但引用还在，恢复即生效）
export interface SourceItem extends SourceRef {
  label: string;
  deleted?: boolean;
  missing?: boolean;
}

export function getConversationSources(db: DB, conversationId: string): SourceRef[] {
  return db
    .select()
    .from(conversationSources)
    .where(eq(conversationSources.conversationId, conversationId))
    .orderBy(conversationSources.createdAt)
    .all()
    .map((r) => ({ type: r.sourceType as "note" | "topic", id: r.sourceId }));
}

// 取来源的展示信息（标题、是否在回收站、是否已彻底删除）
export function describeSources(db: DB, refs: SourceRef[]): SourceItem[] {
  const noteIds = refs.filter((r) => r.type === "note").map((r) => r.id);
  const topicIds = refs.filter((r) => r.type === "topic").map((r) => r.id);
  const noteMap = new Map(
    (noteIds.length
      ? db
          .select({ id: notes.id, title: notes.title, deletedAt: notes.deletedAt })
          .from(notes)
          .where(inArray(notes.id, noteIds))
          .all()
      : []
    ).map((n) => [n.id, n]),
  );
  const topicMap = new Map(
    (topicIds.length
      ? db.select({ id: topics.id, name: topics.name }).from(topics).where(inArray(topics.id, topicIds)).all()
      : []
    ).map((t) => [t.id, t]),
  );

  return refs.map((r) => {
    if (r.type === "note") {
      const n = noteMap.get(r.id);
      if (!n) return { ...r, label: "（已删除的笔记）", missing: true };
      return { ...r, label: n.title || "（无标题笔记）", deleted: n.deletedAt !== null };
    }
    const t = topicMap.get(r.id);
    if (!t) return { ...r, label: "（已删除的主题）", missing: true };
    return { ...r, label: t.name };
  });
}

// 覆盖式写入。去重后整体替换，调用方无需关心增量
export function setConversationSources(
  db: DB,
  conversationId: string,
  refs: SourceRef[],
  now = Date.now(),
): void {
  const seen = new Set<string>();
  const unique = refs.filter((r) => {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  db.transaction((tx) => {
    tx.delete(conversationSources)
      .where(eq(conversationSources.conversationId, conversationId))
      .run();
    for (const r of unique) {
      tx.insert(conversationSources)
        .values({ conversationId, sourceType: r.type, sourceId: r.id, createdAt: now })
        .run();
    }
  });
}

/* 展开来源集为笔记行。回收站笔记一律排除——
   来源集里的引用不随软删除消失（笔记恢复后来源要还在），
   但内容绝不能进 prompt，口径与 buildContext 一致。 */
export function resolveSourceNotes(
  db: DB,
  refs: SourceRef[],
): { id: string; title: string; summary: string | null; content: string }[] {
  const noteIds = refs.filter((r) => r.type === "note").map((r) => r.id);
  const topicIds = refs.filter((r) => r.type === "topic").map((r) => r.id);
  if (noteIds.length === 0 && topicIds.length === 0) return [];

  const cols = {
    id: notes.id,
    title: notes.title,
    summary: notes.summary,
    content: notes.content,
    updatedAt: notes.updatedAt,
  };
  const rows = [
    ...(noteIds.length
      ? db
          .select(cols)
          .from(notes)
          .where(and(inArray(notes.id, noteIds), isNull(notes.deletedAt)))
          .all()
      : []),
    ...(topicIds.length
      ? db
          .select(cols)
          .from(notes)
          .where(and(inArray(notes.topicId, topicIds), isNull(notes.deletedAt)))
          .all()
      : []),
  ];

  // 笔记同时被直接勾选与随主题带入时会重复
  const byId = new Map(rows.map((r) => [r.id, r]));
  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ id, title, summary, content }) => ({ id, title, summary, content }));
}

export interface SourcesContext {
  // 注入 system 的来源正文或清单
  context: string;
  // 限域白名单：只有这些笔记允许被检索与读取
  allowedNoteIds: string[];
  // full = 全文已注入；digest = 超预算只注入清单；empty = 没有可用来源
  mode: "full" | "digest" | "empty";
}

export function buildSourcesContext(db: DB, conversationId: string): SourcesContext {
  const rows = resolveSourceNotes(db, getConversationSources(db, conversationId));
  const allowedNoteIds = rows.map((r) => r.id);
  if (rows.length === 0) {
    return { context: "", allowedNoteIds, mode: "empty" };
  }

  const full = rows
    .map((r) => `## ${r.title || "（无标题笔记）"}\nnoteId: ${r.id}\n\n${r.content}`)
    .join("\n\n---\n\n");
  const header = `来源集共 ${rows.length} 条笔记。\n\n`;
  if (header.length + full.length <= MAX_SOURCES_CHARS) {
    return { context: header + full, allowedNoteIds, mode: "full" };
  }

  const digest = rows
    .map((r) => {
      const brief = r.summary || r.content.slice(0, DIGEST_CHARS).replace(/\n/g, " ");
      return `- noteId: ${r.id}\n  标题: ${r.title || "（无标题）"}\n  摘要: ${brief}`;
    })
    .join("\n");
  return {
    context: `来源集共 ${rows.length} 条笔记，全文过长，以下只是清单。需要正文时用 read_note 按 noteId 读取，用 search_notes 在来源集内检索（两者都已限定在来源集范围内）。\n\n${digest}`,
    allowedNoteIds,
    mode: "digest",
  };
}
