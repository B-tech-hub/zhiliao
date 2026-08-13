// Next.js 启动钩子：仅在 Node.js 运行时启动 AI worker（长驻进程内轮询任务队列）
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("@/db");
    const { rebuildFtsIfNeeded } = await import("@/lib/search");
    rebuildFtsIfNeeded(getDb());
    const { startWorker } = await import("@/lib/ai/worker");
    startWorker();
    const { startDailyBackup } = await import("@/lib/backup");
    startDailyBackup();
  }
}
