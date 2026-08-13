import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { aiJobs } from "@/db/schema";
import { LlmConfigError, LlmRequestError, isLlmConfigured } from "@/lib/llm";
import { markNoteFailed, processNote } from "./process-note";
import { maybeEnqueueSuggestTopics, runSuggestTopics } from "./suggest-topics";

const POLL_INTERVAL_MS = 5000;
const MAX_ATTEMPTS = 3;
// 指数退避：30 秒 / 2 分钟 / 10 分钟
const BACKOFF_MS = [30_000, 120_000, 600_000];

// dev HMR 会重复加载模块，用 globalThis 保证 worker 单例
const g = globalThis as unknown as {
  __kbWorkerStarted?: boolean;
  __kbWorkerKick?: () => void;
};

let running = false;

// 立即触发一次轮询（保存接口调用，正常路径延迟 <1 秒，定时轮询只兜底）
export function kickWorker() {
  g.__kbWorkerKick?.();
}

export function startWorker() {
  if (g.__kbWorkerStarted) return;
  g.__kbWorkerStarted = true;

  const db = getDb();
  // 崩溃恢复：把上次进程遗留的 running 任务重置为 pending
  db.update(aiJobs).set({ status: "pending", updatedAt: Date.now() }).where(eq(aiJobs.status, "running")).run();

  const tick = () => {
    void drainQueue(db);
  };
  g.__kbWorkerKick = tick;
  setInterval(tick, POLL_INTERVAL_MS);
  tick();
  console.log("[ai-worker] 已启动，轮询间隔", POLL_INTERVAL_MS, "ms");
}

// 单并发消费队列：一次醒来把到期任务全部处理完
async function drainQueue(db: DB) {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = db
        .select()
        .from(aiJobs)
        .where(and(eq(aiJobs.status, "pending"), lte(aiJobs.runAfter, Date.now())))
        .orderBy(aiJobs.createdAt)
        .limit(1)
        .get();
      if (!job) break;
      await runJob(db, job.id);
    }
  } finally {
    running = false;
  }
}

async function runJob(db: DB, jobId: string) {
  const job = db.select().from(aiJobs).where(eq(aiJobs.id, jobId)).get();
  if (!job || job.status !== "pending") return;

  if (!isLlmConfigured()) {
    // 未配置 LLM 时不消耗重试次数，1 分钟后再看
    db.update(aiJobs)
      .set({ runAfter: Date.now() + 60_000, lastError: "LLM 未配置", updatedAt: Date.now() })
      .where(eq(aiJobs.id, jobId))
      .run();
    return;
  }

  const attempt = job.attempts + 1;
  db.update(aiJobs)
    .set({ status: "running", attempts: attempt, updatedAt: Date.now() })
    .where(eq(aiJobs.id, jobId))
    .run();

  try {
    if (job.type === "note_process" && job.noteId) {
      await processNote(db, job.noteId);
      maybeEnqueueSuggestTopics(db);
    } else if (job.type === "suggest_topics") {
      await runSuggestTopics(db);
    }
    db.update(aiJobs).set({ status: "done", lastError: null, updatedAt: Date.now() }).where(eq(aiJobs.id, jobId)).run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const retryable = e instanceof LlmRequestError ? e.retryable : !(e instanceof LlmConfigError);

    if (retryable && attempt < MAX_ATTEMPTS) {
      const backoff = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
      db.update(aiJobs)
        .set({ status: "pending", runAfter: Date.now() + backoff, lastError: message, updatedAt: Date.now() })
        .where(eq(aiJobs.id, jobId))
        .run();
      console.warn(`[ai-worker] 任务 ${jobId} 第 ${attempt} 次失败，${backoff / 1000}s 后重试:`, message);
    } else {
      db.update(aiJobs).set({ status: "failed", lastError: message, updatedAt: Date.now() }).where(eq(aiJobs.id, jobId)).run();
      if (job.type === "note_process" && job.noteId) {
        markNoteFailed(db, job.noteId);
      }
      console.error(`[ai-worker] 任务 ${jobId} 最终失败:`, message);
    }
  }
}

// 队列状态概览（设置页展示）
export function getQueueStats(db: DB) {
  const rows = db
    .select({ status: aiJobs.status, count: sql<number>`COUNT(*)` })
    .from(aiJobs)
    .where(inArray(aiJobs.status, ["pending", "running", "failed"]))
    .groupBy(aiJobs.status)
    .all();
  const recentFailures = db
    .select({ id: aiJobs.id, type: aiJobs.type, lastError: aiJobs.lastError, updatedAt: aiJobs.updatedAt })
    .from(aiJobs)
    .where(and(eq(aiJobs.status, "failed"), gt(aiJobs.updatedAt, Date.now() - 7 * 24 * 3600 * 1000)))
    .orderBy(sql`${aiJobs.updatedAt} DESC`)
    .limit(5)
    .all();
  return {
    pending: rows.find((r) => r.status === "pending")?.count ?? 0,
    running: rows.find((r) => r.status === "running")?.count ?? 0,
    failed: rows.find((r) => r.status === "failed")?.count ?? 0,
    recentFailures,
  };
}
