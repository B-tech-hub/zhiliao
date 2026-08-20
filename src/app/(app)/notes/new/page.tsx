import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { topics } from "@/db/schema";
import { NewNoteForm } from "@/components/new-note-form";

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

  return <NewNoteForm topics={topicRows} defaultTopicId={topic} />;
}
