import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// 系统内置“未分类”主题的固定 id
export const INBOX_TOPIC_ID = "inbox";

export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  // 1 = 系统主题（未分类），禁止删除/重命名
  isSystem: integer("is_system").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id),
    title: text("title").notNull().default(""),
    // Markdown 原文
    content: text("content").notNull(),
    // 一句话摘要，仅长笔记有值
    summary: text("summary"),
    // AI 处理状态: pending / processing / done / failed / skipped
    aiStatus: text("ai_status").notNull().default("pending"),
    // 用户手动改过的字段置 1，AI 不再覆盖
    topicLocked: integer("topic_locked").notNull().default(0),
    titleLocked: integer("title_locked").notNull().default(0),
    tagsLocked: integer("tags_locked").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_notes_topic_updated").on(t.topicId, t.updatedAt),
    index("idx_notes_ai_status").on(t.aiStatus),
  ],
);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const noteTags = sqliteTable(
  "note_tags",
  {
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.tagId] }), index("idx_note_tags_tag").on(t.tagId)],
);

export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  // 允许为空：先上传后保存笔记，保存时回填
  noteId: text("note_id"),
  filename: text("filename").notNull().unique(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at").notNull(),
});

// DB 持久化任务队列
export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id"),
    // note_process / suggest_topics
    type: text("type").notNull(),
    // pending / running / done / failed
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    // 退避重试的下次可执行时间（unix 毫秒）
    runAfter: integer("run_after").notNull().default(0),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_ai_jobs_status_run_after").on(t.status, t.runAfter)],
);

export const topicSuggestions = sqliteTable("topic_suggestions", {
  id: text("id").primaryKey(),
  // JSON: { suggestions: [{ name, reason, noteIds, existingTopicId? }] }
  payload: text("payload").notNull(),
  // pending / accepted / dismissed
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

// 应用级 KV 设置（如 LLM 配置覆盖，读取时 DB 优先于环境变量）
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// AI 对话会话：围绕某篇笔记或某个主题（scope_type + scope_id，不加硬外键以兼容两态）
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    // 'note' | 'topic'
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    title: text("title").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_conversations_scope").on(t.scopeType, t.scopeId, t.updatedAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // 'user' | 'assistant'
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_messages_conv").on(t.conversationId, t.createdAt)],
);

export type Topic = typeof topics.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type AiJob = typeof aiJobs.$inferSelect;
export type TopicSuggestion = typeof topicSuggestions.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ChatMessageRow = typeof messages.$inferSelect;
