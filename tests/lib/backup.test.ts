import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { doBackup } from "@/lib/backup";

// doBackup 从环境变量取备份目录位置，从 getSqlite() 单例取数据库内容（测试中为 :memory:）
const saved = { db: process.env.DATABASE_PATH, up: process.env.UPLOAD_DIR };

function restoreEnv(key: "DATABASE_PATH" | "UPLOAD_DIR", value: string | undefined) {
  // 赋值 undefined 会写入字符串 "undefined"，必须用 delete 还原
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("backup", () => {
  afterEach(() => {
    restoreEnv("DATABASE_PATH", saved.db);
    restoreEnv("UPLOAD_DIR", saved.up);
  });

  it("doBackup 同时备份数据库与图片目录，并各按 7 份轮转", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-backup-"));
    process.env.DATABASE_PATH = path.join(tmp, "db", "app.db");
    process.env.UPLOAD_DIR = path.join(tmp, "uploads");
    fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, "a.png"), "fake-image");

    // 伪造 9 天旧备份（文件与目录各 9 份）
    const backupDir = path.join(tmp, "db", "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    for (let i = 1; i <= 9; i++) {
      const day = `2000-01-0${i}`;
      fs.writeFileSync(path.join(backupDir, `app-${day}.db`), "");
      fs.mkdirSync(path.join(backupDir, `uploads-${day}`), { recursive: true });
    }

    await doBackup();

    const entries = fs.readdirSync(backupDir);
    const dbFiles = entries.filter((e) => e.startsWith("app-") && e.endsWith(".db"));
    const uploadDirs = entries.filter((e) => e.startsWith("uploads-"));
    expect(dbFiles.length).toBe(7);
    expect(uploadDirs.length).toBe(7);

    // 当天的快照存在且包含图片
    const stamp = new Date().toISOString().slice(0, 10);
    expect(dbFiles).toContain(`app-${stamp}.db`);
    expect(fs.readdirSync(path.join(backupDir, `uploads-${stamp}`))).toContain("a.png");
    // 被轮转掉的是最旧的
    expect(dbFiles).not.toContain("app-2000-01-01.db");
    expect(uploadDirs).not.toContain("uploads-2000-01-01");
  });

  it("uploads 目录不存在时仅备份数据库，不报错", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-backup-"));
    process.env.DATABASE_PATH = path.join(tmp, "db", "app.db");
    process.env.UPLOAD_DIR = path.join(tmp, "not-exist");

    const target = await doBackup();
    expect(fs.existsSync(target)).toBe(true);
    const entries = fs.readdirSync(path.join(tmp, "db", "backups"));
    expect(entries.some((e) => e.startsWith("uploads-"))).toBe(false);
  });
});
