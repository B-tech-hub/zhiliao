import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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
    transcriptionReviewStatus: text("transcription_review_status").notNull().default("reviewed"),
    transcriptionWarnings: text("transcription_warnings"),
    transcriptionCandidate: text("transcription_candidate"),
    // 用户手动改过的字段置 1，AI 不再覆盖
    topicLocked: integer("topic_locked").notNull().default(0),
    titleLocked: integer("title_locked").notNull().default(0),
    tagsLocked: integer("tags_locked").notNull().default(0),
    // 移入回收站的时间（unix 毫秒）；NULL = 正常笔记。彻底删除才物理删行
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_notes_topic_updated").on(t.topicId, t.updatedAt),
    index("idx_notes_ai_status").on(t.aiStatus),
    // 局部索引只覆盖回收站行，不膨胀主查询
    index("idx_notes_deleted_at").on(t.deletedAt).where(sql`deleted_at IS NOT NULL`),
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
  originalFilename: text("original_filename"),
  originalMime: text("original_mime"),
  originalSize: integer("original_size"),
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
    payload: text("payload"),
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

// AI 助手会话。scope 是「会话创建时的上下文快照」而非归属维度：
// 'global' 表示未附带上下文，'sources' 表示来源问答（来源集另存 conversation_sources）
// （不加硬外键以兼容多态 scope_id）
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    // 'note' | 'topic' | 'global' | 'sources'
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    title: text("title").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_conversations_scope").on(t.scopeType, t.scopeId, t.updatedAt)],
);

// 来源问答的来源集：勾选的笔记与主题。主题是「活引用」——
// 只存主题 id，提问时现查其下笔记，后续新增的笔记自动进入来源范围。
// source_id 同为多态列，不加外键（悬垂行由 trash.ts 清理）
export const conversationSources = sqliteTable(
  "conversation_sources",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // 'note' | 'topic'
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.sourceType, t.sourceId] }),
    index("idx_conversation_sources_src").on(t.sourceType, t.sourceId),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // 'user' | 'assistant' | 'tool'
    role: text("role").notNull(),
    content: text("content").notNull(),
    // 工具调用载荷（JSON）：工具名、参数、结果与撤销所需的 before 快照。
    // 仅 role='tool' 的行有值，重开会话时据此重建操作卡片
    toolPayload: text("tool_payload"),
    /* 深度思考的思考过程。仅 role='assistant' 且走推理模型时有值，
       只用于展示——buildLlmMessages() 不读这一列，绝不回灌给模型
       （供应商会以 400 拒绝，见 docs/adr/0015） */
    reasoning: text("reasoning"),
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
export type ConversationSource = typeof conversationSources.$inferSelect;
export type ChatMessageRow = typeof messages.$inferSelect;
