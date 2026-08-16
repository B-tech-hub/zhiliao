import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { aiJobs, notes, settings, topics } from "@/db/schema";
import type { LlmMessage, StreamChunk } from "@/lib/llm";

/* 假模型：weekly-review 直接 import chatStream（不像 chat-loop 那样注入），
   所以在模块层打桩。output 决定回顾正文，calls 用来断言「空周不调模型」。 */
const { llm } = vi.hoisted(() => ({
  llm: { output: "", calls: 0, seen: [] as LlmMessage[][] },
}));

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return {
    ...actual,
    async *chatStream(msgs: LlmMessage[]) {
      llm.calls += 1;
      llm.seen.push(msgs);
      yield { type: "text", text: llm.output } as StreamChunk;
    },
  };
});

import {
  WEEKLY_REVIEW_KEYS,
  ensureReviewTopic,
  enqueueWeeklyReview,
  getLastReviewWeek,
  isWeeklyReviewEnabled,
  lastWeekRange,
  maybeEnqueueWeeklyReview,
  runWeeklyReview,
  setWeeklyReviewEnabled,
} from "@/lib/ai/weekly-review";
import { replaceNoteTags } from "@/lib/notes";
import { insertNote, insertTopic, wipeData } from "../helpers/db";

// 用例基准时刻：2026-08-12 是周三，上一自然周为 8.3（周一）–8.9（周日）
const WED = new Date(2026, 7, 12, 10, 0, 0);

const jobs = () => getDb().select().from(aiJobs).all();
const reviewNotes = () =>
  getDb().select().from(notes).where(eq(notes.aiStatus, "skipped")).all();

/* 直接查 FTS 影子表：搜索接口在 MATCH 无结果时会降级 LIKE 扫描，
   靠它反推同步是否发生会被掩盖（同 ai-tools.test.ts） */
function ftsRow(noteId: string) {
  return getSqlite()
    .prepare("SELECT title_seg, content_seg FROM notes_fts WHERE note_id = ?")
    .get(noteId) as { title_seg: string; content_seg: string } | undefined;
}

// 在上一自然周内插入一条笔记（day=0 即周一）
function insertLastWeekNote(
  id: string,
  content: string,
  extra: { title?: string; summary?: string; day?: number } = {},
) {
  const week = lastWeekRange(WED);
  insertNote(id, content, {
    title: extra.title ?? "",
    summary: extra.summary ?? null,
    createdAt: week.start + (extra.day ?? 0) * 24 * 3600 * 1000 + 3600 * 1000,
  });
}

beforeEach(() => {
  wipeData();
  llm.output = "本周主线是把知了发出去。\n\n## 发版\n合并了三个批次。";
  llm.calls = 0;
  llm.seen = [];
});

describe("周界计算", () => {
  it("周三：上周一 00:00 至本周一 00:00", () => {
    const w = lastWeekRange(WED);
    expect(w.key).toBe("2026-08-03");
    expect(w.label).toBe("8.3–8.9");
    expect(new Date(w.start).getDate()).toBe(3);
    expect(new Date(w.start).getHours()).toBe(0);
    // 右开区间：本周一零点整
    expect(new Date(w.end).getDate()).toBe(10);
    expect(w.end - w.start).toBe(7 * 24 * 3600 * 1000);
  });

  // 周一凌晨生成的正是刚结束那周，不能算成再往前一周
  it("周一当天：上周 = 刚刚结束的那一周", () => {
    const w = lastWeekRange(new Date(2026, 7, 10, 0, 30, 0));
    expect(w.key).toBe("2026-08-03");
    expect(w.label).toBe("8.3–8.9");
  });

  it("跨月：2026-03-04 周三 → 2.23–3.1", () => {
    const w = lastWeekRange(new Date(2026, 2, 4, 10, 0, 0));
    expect(w.key).toBe("2026-02-23");
    expect(w.label).toBe("2.23–3.1");
  });

  it("跨年：2026-01-07 周三 → 12.29–1.4", () => {
    const w = lastWeekRange(new Date(2026, 0, 7, 10, 0, 0));
    expect(w.key).toBe("2025-12-29");
    expect(w.label).toBe("12.29–1.4");
  });
});

describe("对表入队", () => {
  it("默认开启，关掉后不入队", () => {
    expect(isWeeklyReviewEnabled(getDb())).toBe(true);
    setWeeklyReviewEnabled(getDb(), false);
    maybeEnqueueWeeklyReview(getDb(), WED);
    expect(jobs()).toHaveLength(0);
    expect(getLastReviewWeek(getDb())).toBeNull();
  });

  /* 入队即写 last_week，是防计费循环的关键：若等生成成功再写，
     一个必然失败的周会变成每小时入队一次的真实付费死循环 */
  it("入队即记周，同一周不重复入队", () => {
    maybeEnqueueWeeklyReview(getDb(), WED);
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0].type).toBe("weekly_review");
    expect(jobs()[0].noteId).toBeNull();
    expect(getLastReviewWeek(getDb())).toBe("2026-08-03");

    // 任务已跑完（甚至失败）也不该再来一次
    getDb().update(aiJobs).set({ status: "failed" }).run();
    maybeEnqueueWeeklyReview(getDb(), WED);
    expect(jobs()).toHaveLength(1);
  });

  it("进入新的一周才再次入队", () => {
    maybeEnqueueWeeklyReview(getDb(), WED);
    getDb().update(aiJobs).set({ status: "done" }).run();
    maybeEnqueueWeeklyReview(getDb(), new Date(2026, 7, 19, 10, 0, 0));
    expect(jobs()).toHaveLength(2);
    expect(getLastReviewWeek(getDb())).toBe("2026-08-10");
  });

  // 手动按钮无视 last_week，但仍要防并发重复
  it("已有未完成任务时手动入队返回 false", () => {
    expect(enqueueWeeklyReview(getDb(), lastWeekRange(WED))).toBe(true);
    expect(enqueueWeeklyReview(getDb(), lastWeekRange(WED))).toBe(false);
    expect(jobs()).toHaveLength(1);
  });
});

describe("「每周回顾」主题", () => {
  it("首次调用建主题并记下 id", () => {
    const id = ensureReviewTopic(getDb());
    const topic = getDb().select().from(topics).where(eq(topics.id, id)).get();
    expect(topic?.name).toBe("每周回顾");
    // 普通主题，用户随时可删
    expect(topic?.isSystem).toBe(0);
    const saved = getDb()
      .select()
      .from(settings)
      .where(eq(settings.key, WEEKLY_REVIEW_KEYS.topicId))
      .get();
    expect(saved?.value).toBe(id);
  });

  it("用户改名后沿用同一主题", () => {
    const id = ensureReviewTopic(getDb());
    getDb().update(topics).set({ name: "周报" }).where(eq(topics.id, id)).run();
    expect(ensureReviewTopic(getDb())).toBe(id);
    expect(getDb().select().from(topics).where(eq(topics.id, id)).get()?.name).toBe("周报");
  });

  it("主题被删除则重建", () => {
    const id = ensureReviewTopic(getDb());
    getDb().delete(topics).where(eq(topics.id, id)).run();
    const next = ensureReviewTopic(getDb());
    expect(next).not.toBe(id);
    expect(getDb().select().from(topics).where(eq(topics.id, next)).get()?.name).toBe("每周回顾");
  });

  // 用户手建过同名主题时直接沿用，否则撞 name 唯一约束
  it("已存在同名主题时沿用而非新建", () => {
    insertTopic("manual-1", "每周回顾");
    expect(ensureReviewTopic(getDb())).toBe("manual-1");
    expect(getDb().select().from(topics).all().filter((t) => t.name === "每周回顾")).toHaveLength(1);
  });
});

describe("生成回顾", () => {
  it("空周不产报告也不花钱", async () => {
    // 本周新建的笔记不算进上周
    insertNote("this-week", "今天写的", { createdAt: WED.getTime() });
    await runWeeklyReview(getDb(), WED);
    expect(llm.calls).toBe(0);
    expect(reviewNotes()).toHaveLength(0);
  });

  it("非空周产出锁定的普通笔记并同步索引", async () => {
    insertLastWeekNote("n1", "关于发版流程的长笔记正文……", {
      title: "发版彩排",
      summary: "先打 rc 标签，全绿后再正式 tag",
      day: 0,
    });
    insertLastWeekNote("n2", "短笔记没有摘要，取正文开头", { title: "随手记", day: 3 });
    replaceNoteTags(getDb(), "n1", ["发版"]);

    await runWeeklyReview(getDb(), WED);

    const out = reviewNotes();
    expect(out).toHaveLength(1);
    const note = out[0];
    expect(note.title).toBe("每周回顾 · 8.3–8.9");
    expect(note.content).toBe(llm.output);
    // 不进 AI 流水线；双锁防「用户编辑后重新入队 → AI 改名挪走」
    expect(note.aiStatus).toBe("skipped");
    expect(note.topicLocked).toBe(1);
    expect(note.titleLocked).toBe(1);
    expect(note.topicId).toBe(ensureReviewTopic(getDb()));
    // FTS 存的是分词后的串（「每周 回顾 · …」），只验证索引确实写进去了
    expect(ftsRow(note.id)?.title_seg).toContain("回顾");

    // 输入是标题+标签+摘要，无摘要的取正文开头
    const user = llm.seen[0].at(-1)!.content as string;
    expect(user).toContain("共 2 条笔记");
    expect(user).toContain("发版彩排［发版］：先打 rc 标签");
    expect(user).toContain("随手记：短笔记没有摘要");
    // 全文不进提示词（省上下文，摘要已是概览粒度）
    expect(user).not.toContain("关于发版流程的长笔记正文");
  });

  it("模型无输出时抛错，不留空笔记", async () => {
    insertLastWeekNote("n1", "有内容", { title: "笔记" });
    llm.output = "   ";
    await expect(runWeeklyReview(getDb(), WED)).rejects.toThrow("无输出");
    expect(reviewNotes()).toHaveLength(0);
  });
});
