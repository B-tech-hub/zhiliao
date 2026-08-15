import { getDb, getSqlite } from "@/db";
import { notes, topics } from "@/db/schema";

// 清空业务数据（保留系统主题「未分类」与迁移记录），供 beforeEach 使用。
// 删除顺序遵循外键依赖：先子表后父表。
export function wipeData() {
  getSqlite().exec(`
    DELETE FROM messages;
    DELETE FROM conversation_sources;
    DELETE FROM conversations;
    DELETE FROM note_tags;
    DELETE FROM notes_fts;
    DELETE FROM ai_jobs;
    DELETE FROM topic_suggestions;
    DELETE FROM notes;
    DELETE FROM tags;
    DELETE FROM images;
    DELETE FROM settings;
    DELETE FROM topics WHERE is_system = 0;
  `);
}

export function insertTopic(id: string, name: string) {
  const now = Date.now();
  getDb().insert(topics).values({ id, name, createdAt: now, updatedAt: now }).run();
}

export function insertNote(
  id: string,
  content: string,
  extra: Partial<typeof notes.$inferInsert> = {},
) {
  const now = Date.now();
  getDb()
    .insert(notes)
    .values({ id, topicId: "inbox", title: "", content, createdAt: now, updatedAt: now, ...extra })
    .run();
}
