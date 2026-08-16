// Next.js 启动钩子：仅在 Node.js 运行时启动 AI worker（长驻进程内轮询任务队列）
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("@/db");
    const { rebuildFtsIfNeeded } = await import("@/lib/search");
    rebuildFtsIfNeeded(getDb());
    // 体验模式播种须在 worker 启动之前：入队的任务由 startWorker 首轮 tick 统一消费
    const { seedDemoDataIfNeeded } = await import("@/lib/demo");
    seedDemoDataIfNeeded(getDb());
    const { startWorker } = await import("@/lib/ai/worker");
    startWorker();
    const { startDailyBackup } = await import("@/lib/backup");
    startDailyBackup();
    const { startWeeklyReview } = await import("@/lib/ai/weekly-review");
    startWeeklyReview();
  }
}
