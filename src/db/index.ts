import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrations } from "./migrations";
import * as schema from "./schema";
import { INBOX_TOPIC_ID } from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

// dev 模式 HMR 会重复执行模块，用 globalThis 保证单连接
const globalForDb = globalThis as unknown as {
  __kbSqlite?: Database.Database;
  __kbDb?: DB;
};

function openDatabase(): Database.Database {
  const dbPath = process.env.DATABASE_PATH || "./data/db/app.db";
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");

  runMigrations(sqlite);
  seed(sqlite);
  return sqlite;
}

// 极简迁移器：_migrations 表记录已应用的迁移 id，幂等可重复执行
function runMigrations(sqlite: Database.Database) {
  sqlite
    .prepare(
      "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
    )
    .run();
  const applied = new Set(
    (sqlite.prepare("SELECT id FROM _migrations").all() as { id: string }[]).map((r) => r.id),
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const apply = sqlite.transaction(() => {
      sqlite.exec(m.sql);
      sqlite.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(m.id, Date.now());
    });
    apply();
  }
}

// 内置“未分类”主题
function seed(sqlite: Database.Database) {
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO topics (id, name, is_system, sort_order, created_at, updated_at)
       VALUES (?, '未分类', 1, -1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(INBOX_TOPIC_ID, now, now);
}

export function getSqlite(): Database.Database {
  if (!globalForDb.__kbSqlite) {
    globalForDb.__kbSqlite = openDatabase();
  }
  return globalForDb.__kbSqlite;
}

export function getDb(): DB {
  if (!globalForDb.__kbDb) {
    globalForDb.__kbDb = drizzle(getSqlite(), { schema });
  }
  return globalForDb.__kbDb;
}
