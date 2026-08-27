import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { aiJobs, noteChunks, notes } from "@/db/schema";
import { LlmConfigError, LlmRequestError, isLlmConfigured } from "@/lib/llm";
import { newId } from "@/lib/ids";
import { getEmbeddingConfig, isEmbeddingConfigured } from "@/lib/llm-config";
import { buildNoteChunks, buildNoteEmbeddingText, embedTexts } from "@/lib/ai/embedding";
import { markNoteFailed, processNote } from "./process-note";
import { maybeEnqueueSuggestTopics, runSuggestTopics } from "./suggest-topics";
import { runWeeklyReview } from "./weekly-review";
import { transcribeHandwriting } from "./handwriting";
import { scheduleNoteMarkdownExport } from "@/lib/markdown-export";

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

// 执行单个任务。导出仅供测试：任务类型分发与「按入队时刻算周界」这类
// 判定只在这里，从外面驱动一次比搭起整个轮询循环可靠得多
export async function runJob(db: DB, jobId: string) {
  const job = db.select().from(aiJobs).where(eq(aiJobs.id, jobId)).get();
  if (!job || job.status !== "pending") return;

  const configured = job.type === "embed_note" ? isEmbeddingConfigured() : isLlmConfigured();
  if (!configured) {
    // 未配置 LLM 时不消耗重试次数，1 分钟后再看
    db.update(aiJobs)
      .set({ runAfter: Date.now() + 60_000, lastError: job.type === "embed_note" ? "Embedding 未配置" : "LLM 未配置", updatedAt: Date.now() })
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
      scheduleNoteMarkdownExport(db, job.noteId);
      maybeEnqueueSuggestTopics(db);
    } else if (job.type === "embed_note" && job.noteId) {
      const note = db.select().from(notes).where(and(eq(notes.id, job.noteId), isNull(notes.deletedAt))).get();
      if (note) {
        const cfg = getEmbeddingConfig();
        /* 向量可能落在 notes.embedding（单块）或 note_chunks（多块），幂等检查要认准这一侧。
           chunk_count 为 NULL 则是分块上线前算的整篇向量：看不出它该切几块，一律重算，
           否则存量长笔记会被幂等挡住、永远享受不到分块 */
        const vectorFresh = note.embeddingChunkCount !== null && (note.embeddingChunkCount >= 2 || Boolean(note.embedding));
        if (note.embeddingModel === cfg.model && note.embeddingUpdatedAt !== null && note.embeddingUpdatedAt >= note.updatedAt && vectorFresh) {
          // 已是当前模型且不落后于正文，任务可能是重复入队，直接结束。
        } else {
          /* 长笔记切块后一次请求全部块：embedTexts 的批量上限是 64，块数封顶 20，
             所以请求次数仍是每条笔记 1 次，不随块数翻倍 */
          const chunks = buildNoteChunks(note);
          const multi = chunks.length >= 2;
          const vectors = await embedTexts(multi ? chunks : [buildNoteEmbeddingText(note)]);
          const latest = db.select({ updatedAt: notes.updatedAt }).from(notes).where(and(eq(notes.id, note.id), isNull(notes.deletedAt))).get();
          if (!latest || latest.updatedAt !== note.updatedAt) {
            /* 请求在途期间正文发生变化：丢弃旧向量并让同一任务重新读取最新正文。
               attempts 一并回退——这不是失败，连续编辑不该把重试次数耗成 failed。 */
            db.update(aiJobs).set({ status: "pending", attempts: job.attempts, runAfter: Date.now(), lastError: "正文在向量请求期间发生变化", updatedAt: Date.now() }).where(eq(aiJobs.id, jobId)).run();
            return;
          }
          const dim = vectors[0].length;
          if (vectors.some((v) => v.length !== dim)) {
            // 同一次请求内维度不一致：混着落库会让部分块永久算不出相似度且不计入提示
            throw new LlmRequestError("Embedding 同批返回的向量维度不一致", false);
          }
          const meta = { embeddingModel: cfg.model, embeddingDim: dim, embeddingUpdatedAt: note.updatedAt };
          db.transaction((tx) => {
            /* 两侧必须互斥：笔记从长改短会留下旧块，从短改长会留下旧的整篇向量，
               任一残留都让同一条笔记在 max-pooling 里拿两个分 */
            tx.delete(noteChunks).where(eq(noteChunks.noteId, note.id)).run();
            if (multi) {
              tx.update(notes).set({ embedding: null, embeddingChunkCount: chunks.length, ...meta }).where(eq(notes.id, note.id)).run();
              tx.insert(noteChunks)
                .values(chunks.map((text, index) => ({
                  id: newId(),
                  noteId: note.id,
                  chunkIndex: index,
                  text,
                  embedding: Buffer.from(new Float32Array(vectors[index]).buffer),
                  ...meta,
                })))
                .run();
            } else {
              tx.update(notes)
                .set({ embedding: Buffer.from(new Float32Array(vectors[0]).buffer), embeddingChunkCount: 1, ...meta })
                .where(eq(notes.id, note.id))
                .run();
            }
          });
        }
      }
    } else if (job.type === "handwriting_transcribe" && job.noteId) {
      const payload = job.payload ? JSON.parse(job.payload) as { filename?: string; baseUpdatedAt?: number } : {};
      if (!payload.filename) throw new Error("手写任务缺少图片文件名");
      const outcome = await transcribeHandwriting(db, job.noteId, payload.filename, payload.baseUpdatedAt);
      db.update(aiJobs).set({ status: "done", updatedAt: Date.now() }).where(eq(aiJobs.id, jobId)).run();
      const note = db.select({ id: aiJobs.noteId }).from(aiJobs).where(eq(aiJobs.id, jobId)).get();
      if (note?.id && outcome === "appended") {
        scheduleNoteMarkdownExport(db, note.id);
        const { enqueueNoteProcess } = await import("@/lib/notes");
        enqueueNoteProcess(db, note.id);
      }
    } else if (job.type === "suggest_topics") {
      await runSuggestTopics(db);
    } else if (job.type === "weekly_review") {
      /* 周界按入队时刻算，不是执行时刻。任务可能因停机、LLM 未配置或退避重试
         拖到跨周才跑起来，那时现算会得出另一周——原定的那周永远补不回来
         （对表已经把它记成「已安排」），还会和新一周的任务生成同一篇。
         实测踩过：周日入队的任务周一才执行，8.3–8.9 的回顾就此丢失，
         8.10–8.16 反倒出了两篇。 */
      await runWeeklyReview(db, new Date(job.createdAt));
    } else {
      /* 显式炸掉而非静默标 done：以前新增任务类型忘了加分支，任务会「成功」
         消失得无影无踪。抛普通 Error 走通用重试，三次后落 failed，
         在设置页「最近失败」里看得见 */
      throw new Error(`未知任务类型 ${job.type}${job.noteId ? "" : "（无 noteId）"}`);
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
