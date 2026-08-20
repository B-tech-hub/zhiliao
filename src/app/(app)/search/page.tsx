import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { topics } from "@/db/schema";
import { SearchClient } from "./search-client";

export const dynamic = "force-dynamic";

export default function SearchPage() {
  const db = getDb();
  const topicRows = db
    .select({ id: topics.id, name: topics.name, isSystem: topics.isSystem })
    .from(topics)
    .orderBy(asc(topics.sortOrder), asc(topics.createdAt))
    .all();
  return <SearchClient topics={topicRows} />;
}
