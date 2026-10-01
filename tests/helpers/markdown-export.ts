import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers";

// 每个隔离测试模块使用独立目录，不继承宿主的真实导出位置。
export const testNotesExportDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-test-notes-"));

export function restoreTestNotesExportDir(): void {
  process.env.NOTES_EXPORT_DIR = testNotesExportDir;
}

// 当前导出回调是单层 setImmediate，回调内同步写文件；不是通用异步任务屏障。
export function drainPendingMarkdownExports(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function removeTestNotesExportDir(): void {
  fs.rmSync(testNotesExportDir, { recursive: true, force: true });
}
