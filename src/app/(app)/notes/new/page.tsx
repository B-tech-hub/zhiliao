import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { topics } from "@/db/schema";
import { NewNoteForm } from "@/components/new-note-form";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic } = await searchParams;
  const db = getDb();
  const topicRows = db
    .select({ id: topics.id, name: topics.name, isSystem: topics.isSystem })
    .from(topics)
    .orderBy(asc(topics.sortOrder), asc(topics.createdAt))
    .all();

  // 整页形态进不去 (app)/layout 的作用域，开关得自己读一次
  return (
    <NewNoteForm
      topics={topicRows}
      defaultTopicId={topic}
      handwritingEnabled={isFeatureEnabled(db, "handwriting")}
    />
  );
}
