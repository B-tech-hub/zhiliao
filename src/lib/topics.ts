import { cache } from "react";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";

/* 主题列表 + 各主题笔记数：一次 LEFT JOIN 聚合查询，
   cache() 保证 layout 与 page 在同一请求内只执行一次 SQL。
   COUNT(notes.id) 而非 COUNT(*)：无笔记的主题计数为 0。
   回收站过滤放在 JOIN 的 ON 条件——放 WHERE 会把只剩回收站笔记的主题整行滤掉 */
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
    .leftJoin(notes, and(eq(notes.topicId, topics.id), isNull(notes.deletedAt)))
    .groupBy(topics.id)
    .orderBy(asc(topics.sortOrder), asc(topics.createdAt))
    .all();
});
