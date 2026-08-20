// 迁移以内嵌 SQL 方式管理：避免 standalone 构建时丢失 .sql 文件。
// 规则：只能追加新迁移，禁止修改已发布迁移的内容。

export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: "0001_init",
    sql: `
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  summary TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  topic_locked INTEGER NOT NULL DEFAULT 0,
  title_locked INTEGER NOT NULL DEFAULT 0,
  tags_locked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_topic_updated ON notes(topic_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_ai_status ON notes(ai_status);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  note_id TEXT,
  filename TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  note_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status_run_after ON ai_jobs(status, run_after);

CREATE TABLE IF NOT EXISTS topic_suggestions (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
`,
  },
  {
    id: "0002_fts",
    sql: `
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  note_id UNINDEXED,
  title_seg,
  content_seg,
  tags_seg,
  tokenize = 'unicode61'
);
`,
  },
  {
    id: "0003_settings",
    sql: `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
  },
  {
    id: "0004_conversations",
    sql: `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_scope ON conversations(scope_type, scope_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
`,
  },
  {
    id: "0005_soft_delete",
    sql: `
ALTER TABLE notes ADD COLUMN deleted_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at) WHERE deleted_at IS NOT NULL;
`,
  },
  {
    // AI 助手工具调用：messages 增加工具调用载荷。
    // conversations.scope_type 新增 'global' 取值属值层面变化，无需 DDL。
    id: "0006_assistant_tools",
    sql: `
ALTER TABLE messages ADD COLUMN tool_payload TEXT;
`,
  },
  {
    // 来源问答：会话的来源集。
    // conversations.scope_type 新增 'sources' 取值属值层面变化，无需 DDL。
    // source_id 不加外键，与 conversations.scope_id 同为多态列（可指向笔记或主题），
    // 悬垂行由 trash.ts 的 purgeNoteRows / purgeOrphans 清理。
    id: "0007_conversation_sources",
    sql: `
CREATE TABLE IF NOT EXISTS conversation_sources (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_sources_src ON conversation_sources(source_type, source_id);
`,
  },
  {
    id: "0008_image_originals",
    sql: `
ALTER TABLE images ADD COLUMN original_filename TEXT;
ALTER TABLE images ADD COLUMN original_mime TEXT;
ALTER TABLE images ADD COLUMN original_size INTEGER;
`,
  },
  {
    // 深度思考：assistant 消息保存推理模型吐出的思考过程。
    // 只读不发——重建历史时不进 LLM 上下文（见 docs/adr/0015）
    id: "0009_message_reasoning",
    sql: `
ALTER TABLE messages ADD COLUMN reasoning TEXT;
`,
  },
  {
    id: "0010_handwriting_transcription",
    sql: `
ALTER TABLE notes ADD COLUMN transcription_review_status TEXT NOT NULL DEFAULT 'reviewed';
ALTER TABLE notes ADD COLUMN transcription_warnings TEXT;
ALTER TABLE notes ADD COLUMN transcription_candidate TEXT;
ALTER TABLE ai_jobs ADD COLUMN payload TEXT;
`,
  },
];
