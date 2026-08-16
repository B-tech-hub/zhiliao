// 每周回顾：每周一凌晨，把上一自然周（周一至周日）新建的笔记交给 LLM
// 梳理成一篇脉络回顾，产物是一条普通笔记，归入自动创建的「每周回顾」主题。
//
// 调度不是日历定时器（现有基础设施只有「启动后每 24h」的 interval），而是
// 「对表」：settings 记录已生成的周，每小时比对一次，进入新的一周即入队。
// 重启安全、错过自动补：服务器周一停机、周三开机，开机后一小时内照样补生成。
// 时区用服务器本地时间——容器默认 UTC，想按北京时间分周需设 TZ 环境变量（见 README）。

import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { aiJobs, notes, settings, topics } from "@/db/schema";
import { newId } from "@/lib/ids";
import { chatStream } from "@/lib/llm";
import { getTagsForNotes } from "@/lib/notes";
import { refreshNoteFts } from "@/lib/search";

export const WEEKLY_REVIEW_KEYS = {
  // "0" = 关闭；缺省 = 开启（默认开，与产品「AI 自动整理」的基调一致）
  enabled: "weekly_review_enabled",
  // 已安排生成的周（上周一的本地日期 YYYY-MM-DD）。入队即写：
  // 失败重试交给 worker 的三次退避，绝不能靠「失败后下小时再入队」——
  // 那会变成每小时一次真实计费的无限失败循环
  lastWeek: "weekly_review_last_week",
  // 「每周回顾」主题 id。按 id 引用而非按名字查：用户改名照用，删除才重建
  topicId: "weekly_review_topic_id",
} as const;

// 一次回顾最多取多少条笔记作输入（按创建时间倒序截取）
const MAX_NOTES_PER_REVIEW = 100;
// 无摘要的笔记取正文前多少字符
const CONTENT_FALLBACK_CHARS = 120;

const pad = (n: number) => String(n).padStart(2, "0");

export interface WeekRange {
  // [start, end)：上周一 00:00 至本周一 00:00，本地时区
  start: number;
  end: number;
  // 幂等 key：上周一的本地日期，如 "2026-08-10"
  key: string;
  // 标题用的区间文字，如 "8.10–8.16"
  label: string;
}

// 上一自然周。setDate 会自动进退位，跨月跨年都正确
export function lastWeekRange(now: Date = new Date()): WeekRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceMonday = (today.getDay() + 6) % 7; // 周一=0 … 周日=6
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - sinceMonday);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  const sunday = new Date(thisMonday.getTime() - 1);
  return {
    start: lastMonday.getTime(),
    end: thisMonday.getTime(),
    key: `${lastMonday.getFullYear()}-${pad(lastMonday.getMonth() + 1)}-${pad(lastMonday.getDate())}`,
    label: `${lastMonday.getMonth() + 1}.${lastMonday.getDate()}–${sunday.getMonth() + 1}.${sunday.getDate()}`,
  };
}

function getSetting(db: DB, key: string): string | null {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

function putSetting(db: DB, key: string, value: string): void {
  const now = Date.now();
  db.insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
    .run();
}

export function isWeeklyReviewEnabled(db: DB): boolean {
  return getSetting(db, WEEKLY_REVIEW_KEYS.enabled) !== "0";
}

export function setWeeklyReviewEnabled(db: DB, enabled: boolean): void {
  putSetting(db, WEEKLY_REVIEW_KEYS.enabled, enabled ? "1" : "0");
}

export function getLastReviewWeek(db: DB): string | null {
  return getSetting(db, WEEKLY_REVIEW_KEYS.lastWeek);
}

/* 「每周回顾」主题：settings 存 id。改名沿用（id 不变），删除则下次生成时重建。
   建的是普通主题（isSystem=0）——用户不想要随时可删，与「未分类不可删」区分开。 */
export function ensureReviewTopic(db: DB): string {
  const saved = getSetting(db, WEEKLY_REVIEW_KEYS.topicId);
  if (saved && db.select({ id: topics.id }).from(topics).where(eq(topics.id, saved)).get()) {
    return saved;
  }
  // 重建时若已存在同名主题（如用户手建过），直接沿用，避免撞 name 唯一约束
  const now = Date.now();
  const existing = db.select({ id: topics.id }).from(topics).where(eq(topics.name, "每周回顾")).get();
  const id = existing?.id ?? newId();
  if (!existing) {
    db.insert(topics)
      .values({ id, name: "每周回顾", isSystem: 0, sortOrder: 0, createdAt: now, updatedAt: now })
      .run();
  }
  putSetting(db, WEEKLY_REVIEW_KEYS.topicId, id);
  return id;
}

// 入队一次回顾生成（已有未完成的则跳过），并记下已安排的周。
// 自动路径走 maybeEnqueueWeeklyReview（带 last_week 判定）；设置页的手动按钮
// 直接调本函数，无视 last_week，只防并发重复
export function enqueueWeeklyReview(db: DB, week: WeekRange): boolean {
  const existing = db
    .select({ id: aiJobs.id })
    .from(aiJobs)
    .where(and(eq(aiJobs.type, "weekly_review"), inArray(aiJobs.status, ["pending", "running"])))
    .get();
  if (existing) return false;
  const now = Date.now();
  db.insert(aiJobs)
    .values({ id: newId(), noteId: null, type: "weekly_review", status: "pending", runAfter: now, createdAt: now, updatedAt: now })
    .run();
  putSetting(db, WEEKLY_REVIEW_KEYS.lastWeek, week.key);
  // 通过 globalThis 触发 worker 立即轮询（worker 反向 import 了本模块，不能直接引用）
  (globalThis as { __kbWorkerKick?: () => void }).__kbWorkerKick?.();
  return true;
}

// 对表：开着、且上一自然周还没安排过，就入队。每小时被调一次，也在启动后调一次
export function maybeEnqueueWeeklyReview(db: DB, now: Date = new Date()): void {
  if (!isWeeklyReviewEnabled(db)) return;
  const week = lastWeekRange(now);
  if (getLastReviewWeek(db) === week.key) return;
  enqueueWeeklyReview(db, week);
}

/* 生成回顾正文。输入用标题+标签+摘要而非全文：
   一周几十条笔记的全文轻松超出上下文，而 AI 流水线已经为每条长笔记
   写过摘要，回顾要的正是这种概览粒度。无摘要（短笔记）取正文开头。 */
export async function runWeeklyReview(db: DB, now: Date = new Date()): Promise<void> {
  const week = lastWeekRange(now);
  const rows = db
    .select({ id: notes.id, title: notes.title, summary: notes.summary, content: notes.content, createdAt: notes.createdAt })
    .from(notes)
    .where(and(isNull(notes.deletedAt), gte(notes.createdAt, week.start), lt(notes.createdAt, week.end)))
    .orderBy(desc(notes.createdAt))
    .limit(MAX_NOTES_PER_REVIEW)
    .all();

  // 空周不产报告：一条「本周你什么都没记」的笔记只是垃圾
  if (rows.length === 0) return;

  const tagMap = getTagsForNotes(db, rows.map((n) => n.id));
  const digest = rows
    .map((n) => {
      const day = new Date(n.createdAt);
      const tags = tagMap.get(n.id)?.length ? `［${tagMap.get(n.id)!.join("、")}］` : "";
      const gist = n.summary || n.content.replace(/\s+/g, " ").slice(0, CONTENT_FALLBACK_CHARS);
      return `- ${day.getMonth() + 1}.${day.getDate()}｜${n.title || "（无标题）"}${tags}：${gist}`;
    })
    .join("\n");

  const system =
    "你是个人知识库的整理助手。用户会给你过去一周全部笔记的清单（标题、标签、摘要）。" +
    "请写一篇本周回顾，Markdown 格式：先用两三句话概括这一周的主线，" +
    "再按主题脉络分几个小节梳理（合并相关笔记，而不是逐条罗列），" +
    "最后指出值得继续跟进的一两条线索。语气平实，不要客套开场白，不要输出标题（标题由系统生成）。";

  let content = "";
  for await (const chunk of chatStream([
    { role: "system", content: system },
    { role: "user", content: `本周（${week.label}）共 ${rows.length} 条笔记：\n\n${digest}` },
  ])) {
    if (chunk.type === "text") content += chunk.text;
  }
  if (!content.trim()) throw new Error("每周回顾生成失败：模型无输出");

  /* 不走 createNote：它会把笔记标为 pending 并入队 AI 流水线，而回顾的
     标题与归属由这里直接定，不需要也不应该再被整理一遍。锁上 topic/title
     是防「用户编辑回顾正文 → 触发重新入队 → AI 把回顾改名挪走」。 */
  const topicId = ensureReviewTopic(db);
  const id = newId();
  const created = Date.now();
  db.insert(notes)
    .values({
      id,
      topicId,
      title: `每周回顾 · ${week.label}`,
      content: content.trim(),
      aiStatus: "skipped",
      topicLocked: 1,
      titleLocked: 1,
      createdAt: created,
      updatedAt: created,
    })
    .run();
  refreshNoteFts(db, id);
  console.log(`[weekly-review] 已生成 ${week.label} 的回顾（${rows.length} 条笔记）`);
}

// 每小时对一次表。dev HMR 会重复加载模块，globalThis 守卫保证单例（同 backup.ts）
const g = globalThis as unknown as { __kbWeeklyReviewStarted?: boolean };
const CHECK_INTERVAL_MS = 3600 * 1000;

export function startWeeklyReview(): void {
  if (g.__kbWeeklyReviewStarted) return;
  g.__kbWeeklyReviewStarted = true;
  const tick = () => {
    try {
      maybeEnqueueWeeklyReview(getDb());
    } catch (e) {
      console.error("[weekly-review] 对表失败:", e);
    }
  };
  // 启动一分钟后先对一次（补上停机期间错过的周），此后每小时一次
  setTimeout(tick, 60 * 1000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
