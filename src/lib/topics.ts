import { cache } from "react";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";

/* 主题列表 + 各主题笔记数：一次 LEFT JOIN 聚合查询，
   cache() 保证 layout 与 page 在同一请求内只执行一次 SQL。
   COUNT(notes.id) 而非 COUNT(*)：无笔记的主题计数为 0 */
export const getTopicsWithCounts = cache(() => {
  const db = getDb();
  return db
    .select({
      id: topics.id,
      name: topics.name,
      isSystem: topics.isSystem,
      noteCount: sql<number>`COUNT(${notes.id})`,
    })
    .from(topics)
    .leftJoin(notes, eq(notes.topicId, topics.id))
    .groupBy(topics.id)
    .orderBy(asc(topics.sortOrder), asc(topics.createdAt))
    .all();
});
