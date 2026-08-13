import fs from "node:fs";
import path from "node:path";
import { getSqlite } from "@/db";

const g = globalThis as unknown as { __kbBackupStarted?: boolean };

const KEEP_COUNT = 7;
const DAY_MS = 24 * 3600 * 1000;

// 每日备份 SQLite 到数据目录下 backups/，保留最近 7 份
export function startDailyBackup() {
  if (g.__kbBackupStarted) return;
  g.__kbBackupStarted = true;
  const run = () => {
    void doBackup().catch((e) => console.error("[backup] 备份失败:", e));
  };
  // 启动 5 分钟后先做一次，之后每天一次
  setTimeout(run, 5 * 60 * 1000);
  setInterval(run, DAY_MS);
}

export async function doBackup(): Promise<string> {
  const dbPath = process.env.DATABASE_PATH || "./data/db/app.db";
  const backupDir = path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(backupDir, `app-${stamp}.db`);
  await getSqlite().backup(target);
  console.log("[backup] 已备份到", target);

  // 清理超出保留数量的旧备份
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("app-") && f.endsWith(".db"))
    .sort()
    .reverse();
  for (const f of files.slice(KEEP_COUNT)) {
    fs.unlinkSync(path.join(backupDir, f));
  }
  return target;
}
