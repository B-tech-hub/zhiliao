import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { INBOX_TOPIC_ID, notes, topicSuggestions, topics } from "@/db/schema";
import { getTagsForNotes } from "@/lib/notes";
import { InboxClient } from "./inbox-client";

export const dynamic = "force-dynamic";

// 未分类整理页：AI 建议卡片 + 多选批量移动
export default function InboxPage() {
  const db = getDb();
  const rows = db
    .select()
    .from(notes)
    .where(and(eq(notes.topicId, INBOX_TOPIC_ID), isNull(notes.deletedAt)))
    .orderBy(desc(notes.updatedAt))
    .limit(200)
    .all();
  const tagMap = getTagsForNotes(db, rows.map((n) => n.id));

  const topicRows = db
    .select({ id: topics.id, name: topics.name, isSystem: topics.isSystem })
    .from(topics)
    .orderBy(asc(topics.sortOrder), asc(topics.createdAt))
    .all();

  const suggestionRow = db
    .select()
    .from(topicSuggestions)
    .where(eq(topicSuggestions.status, "pending"))
    .orderBy(desc(topicSuggestions.createdAt))
    .limit(1)
    .get();
  const suggestion = suggestionRow
    ? {
        id: suggestionRow.id,
        ...(JSON.parse(suggestionRow.payload) as {
          suggestions: {
            name: string;
            reason: string;
            noteIds: string[];
            existingTopicId: string | null;
          }[];
        }),
      }
    : null;

  return (
    <InboxClient
      notes={rows.map((n) => ({ ...n, tags: tagMap.get(n.id) ?? [] }))}
      topics={topicRows}
      suggestion={suggestion}
    />
  );
}
