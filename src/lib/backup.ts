import fs from "node:fs";
import path from "node:path";
import { getDb, getSqlite } from "@/db";
import { sweepTrash } from "@/lib/trash";

const g = globalThis as unknown as {
  __kbBackupStarted?: boolean;
  __kbBackupInFlight?: Promise<string> | null;
};

const KEEP_COUNT = 7;
const DAY_MS = 24 * 3600 * 1000;

// 每日备份：SQLite 快照 + uploads 图片目录快照，各保留最近 7 份。
// 回收站清扫只挂在备份成功之后：被清数据必然存在于刚完成的当天备份里，
// 备份失败当天不清扫（无快照不销毁）；手动 POST /api/backup 不触发清扫
export function startDailyBackup() {
  if (g.__kbBackupStarted) return;
  g.__kbBackupStarted = true;
  const run = () => {
    void doBackup()
      .then(() => {
        try {
          const r = sweepTrash(getDb());
          if (r.purged || r.images || r.conversations) {
            console.log(`[trash] 清扫完成：笔记 ${r.purged}、孤儿图片 ${r.images}、孤儿会话 ${r.conversations}`);
          }
        } catch (e) {
          console.error("[trash] 清扫失败:", e);
        }
      })
      .catch((e) => console.error("[backup] 备份失败:", e));
  };
  // 启动 5 分钟后先做一次，之后每天一次
  setTimeout(run, 5 * 60 * 1000);
  setInterval(run, DAY_MS);
}

// 最近一次备份完成时间（备份文件名只有天粒度，精确时间取自 mtime）；从未备份返回 null
export function getLastBackupAt(): number | null {
  const dbPath = process.env.DATABASE_PATH || "./data/db/app.db";
  const backupDir = path.join(path.dirname(dbPath), "backups");
  if (!fs.existsSync(backupDir)) return null;
  let latest: number | null = null;
  for (const e of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.startsWith("app-") || !e.name.endsWith(".db")) continue;
    const { mtimeMs } = fs.statSync(path.join(backupDir, e.name));
    if (latest === null || mtimeMs > latest) latest = mtimeMs;
  }
  return latest;
}

// 进行中的备份被后续调用复用，防设置页连点、防手动备份与每日定时撞车
export function doBackup(): Promise<string> {
  if (g.__kbBackupInFlight) return g.__kbBackupInFlight;
  const p = runBackup().finally(() => {
    g.__kbBackupInFlight = null;
  });
  g.__kbBackupInFlight = p;
  return p;
}

async function runBackup(): Promise<string> {
  const dbPath = process.env.DATABASE_PATH || "./data/db/app.db";
  const backupDir = path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(backupDir, `app-${stamp}.db`);
  await getSqlite().backup(target);

  // 图片目录快照：同日重复备份先删后拷，避免残留当天已删除的文件；
  // 明文目录而非压缩包——灾难恢复时资源管理器直接复制即可，无需任何工具
  const uploadDir = process.env.UPLOAD_DIR || "./data/uploads";
  const uploadsTarget = path.join(backupDir, `uploads-${stamp}`);
  if (fs.existsSync(uploadDir)) {
    fs.rmSync(uploadsTarget, { recursive: true, force: true });
    await fs.promises.cp(uploadDir, uploadsTarget, { recursive: true });
  }
  console.log("[backup] 已备份到", target);

  // 轮转：数据库文件与图片目录分别保留最近 KEEP_COUNT 份，互不影响
  const entries = fs.readdirSync(backupDir, { withFileTypes: true });
  const dbFiles = entries
    .filter((e) => e.isFile() && e.name.startsWith("app-") && e.name.endsWith(".db"))
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const f of dbFiles.slice(KEEP_COUNT)) {
    fs.unlinkSync(path.join(backupDir, f));
  }
  const uploadDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("uploads-"))
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const d of uploadDirs.slice(KEEP_COUNT)) {
    fs.rmSync(path.join(backupDir, d), { recursive: true, force: true });
  }
  return target;
}
