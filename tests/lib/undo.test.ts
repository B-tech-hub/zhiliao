import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { notes, topics } from "@/db/schema";
import { runTool, type ToolContext, type UndoPayload } from "@/lib/ai/tools";
import { undoToolAction } from "@/lib/ai/undo";
import { getTagsForNotes } from "@/lib/notes";
import { insertTopic, wipeData } from "../helpers/db";

const ctx = (): ToolContext => ({ db: getDb(), userUrls: [] });

const call = (name: string, args: Record<string, unknown> = {}) =>
  runTool(name, JSON.stringify(args), ctx());

const noteRow = (id: string) => getDb().select().from(notes).where(eq(notes.id, id)).get();

const undo = (payload: UndoPayload) => undoToolAction(getDb(), payload);

// 工具执行后取出撤销载荷；没有载荷说明工具压根没成功
async function actAndTakeUndo(name: string, args: Record<string, unknown>) {
  const outcome = await call(name, args);
  expect(outcome.error, `工具 ${name} 未成功：${outcome.content}`).toBeUndefined();
  expect(outcome.undo).toBeDefined();
  return outcome.undo as UndoPayload;
}

/* 模拟后台 AI 处理完成。process-note.ts 的 patch 里带着 updatedAt: Date.now()，
   这正是「撤销不能用 updatedAt 做乐观锁」的原因，此处用它做回归防线。 */
function simulateAiProcessed(noteId: string, patch: Record<string, unknown> = {}) {
  getDb()
    .update(notes)
    .set({ updatedAt: Date.now() + 60_000, aiStatus: "done", ...patch })
    .where(eq(notes.id, noteId))
    .run();
}

beforeEach(() => {
  wipeData();
});

describe("撤销 create_note", () => {
  it("撤销后笔记进回收站", async () => {
    const payload = await actAndTakeUndo("create_note", { content: "今天跑了 5 公里" });
    expect(undo(payload)).toEqual({ ok: true });
    expect(noteRow(payload.noteId)?.deletedAt).toBeTruthy();
  });

  /* 这条是本轮改造的核心回归：批次 B 原本用 afterUpdatedAt 做乐观锁，
     而 create_note 会重新入队 AI，处理完成时 updatedAt 必被刷新，
     用户点撤销时必然判为「已被修改」——助手新建的笔记将永远撤销不了。 */
  it("后台 AI 处理刷新 updatedAt 后依然可以撤销", async () => {
    const payload = await actAndTakeUndo("create_note", { content: "今天跑了 5 公里" });
    simulateAiProcessed(payload.noteId, { title: "跑步记录" });
    expect(noteRow(payload.noteId)?.updatedAt).not.toBe(payload.afterUpdatedAt);
    expect(undo(payload)).toEqual({ ok: true });
    expect(noteRow(payload.noteId)?.deletedAt).toBeTruthy();
  });

  it("正文被用户改写过则拒绝撤销", async () => {
    const payload = await actAndTakeUndo("create_note", { content: "今天跑了 5 公里" });
    getDb().update(notes).set({ content: "今天跑了 10 公里" }).where(eq(notes.id, payload.noteId)).run();
    expect(undo(payload).ok).toBe(false);
    expect(noteRow(payload.noteId)?.deletedAt).toBeFalsy();
  });

  it("笔记已在回收站时重复撤销不报错", async () => {
    const payload = await actAndTakeUndo("create_note", { content: "今天跑了 5 公里" });
    expect(undo(payload)).toEqual({ ok: true });
    expect(undo(payload)).toEqual({ ok: true });
  });
});

describe("撤销 append_to_note", () => {
  async function seedNote() {
    const created = await actAndTakeUndo("create_note", { content: "原始正文" });
    simulateAiProcessed(created.noteId);
    return created.noteId;
  }

  it("撤销后正文截回追加前的内容", async () => {
    const noteId = await seedNote();
    const payload = await actAndTakeUndo("append_to_note", { noteId, text: "追加的一段" });
    expect(noteRow(noteId)?.content).toContain("追加的一段");
    expect(undo(payload)).toEqual({ ok: true });
    expect(noteRow(noteId)?.content).toBe("原始正文");
  });

  /* 主计划验证方案第 4 条：追加后手动编辑笔记，撤销必须被拒。
     这是唯一会毁掉用户编辑且不可恢复的反向操作（ADR-0007 无版本历史）。 */
  it("用户在追加后编辑过正文时拒绝撤销，且不动正文", async () => {
    const noteId = await seedNote();
    const payload = await actAndTakeUndo("append_to_note", { noteId, text: "追加的一段" });
    const edited = `${noteRow(noteId)?.content}\n用户自己补的一句`;
    getDb().update(notes).set({ content: edited }).where(eq(notes.id, noteId)).run();

    expect(undo(payload)).toEqual({ ok: false, reason: "笔记已被修改，无法自动撤销" });
    expect(noteRow(noteId)?.content).toBe(edited);
  });

  it("撤销恢复追加前的 aiStatus，不重新入队 AI", async () => {
    const noteId = await seedNote();
    const payload = await actAndTakeUndo("append_to_note", { noteId, text: "追加的一段" });
    // 追加会把状态打回 pending，撤销后应回到追加前的 done
    expect(noteRow(noteId)?.aiStatus).toBe("pending");
    expect(undo(payload)).toEqual({ ok: true });
    expect(noteRow(noteId)?.aiStatus).toBe("done");
  });
});

describe("撤销 update_meta", () => {
  async function seedClassified() {
    insertTopic("t-old", "旧主题");
    insertTopic("t-new", "新主题");
    const created = await actAndTakeUndo("create_note", { content: "一条笔记", topicId: "t-old" });
    getDb()
      .update(notes)
      .set({ title: "旧标题", titleLocked: 0, topicLocked: 0, tagsLocked: 0 })
      .where(eq(notes.id, created.noteId))
      .run();
    return created.noteId;
  }

  it("撤销后主题、标题、标签一并恢复", async () => {
    const noteId = await seedClassified();
    const payload = await actAndTakeUndo("update_meta", {
      noteId,
      topicId: "t-new",
      title: "新标题",
      tags: ["跑步"],
    });
    expect(undo(payload)).toEqual({ ok: true });

    const row = noteRow(noteId);
    expect(row?.topicId).toBe("t-old");
    expect(row?.title).toBe("旧标题");
    expect(getTagsForNotes(getDb(), [noteId]).get(noteId) ?? []).toEqual([]);
  });

  /* 只恢复值不恢复锁，这条笔记会永久失去 AI 自动整理——
     用户看到的是「撤销之后 AI 再也不管这条笔记了」，且无从解释。 */
  it("撤销把锁位一并恢复，笔记不会永久失去 AI 自动整理", async () => {
    const noteId = await seedClassified();
    const payload = await actAndTakeUndo("update_meta", { noteId, title: "新标题" });
    expect(noteRow(noteId)?.titleLocked).toBe(1);
    expect(undo(payload)).toEqual({ ok: true });
    expect(noteRow(noteId)?.titleLocked).toBe(0);
  });

  it("用户在此之后又改过元数据时拒绝撤销", async () => {
    const noteId = await seedClassified();
    const payload = await actAndTakeUndo("update_meta", { noteId, title: "新标题" });
    getDb().update(notes).set({ title: "用户自己改的" }).where(eq(notes.id, noteId)).run();

    expect(undo(payload).ok).toBe(false);
    expect(noteRow(noteId)?.title).toBe("用户自己改的");
  });

  /* 旧主题可能在此期间被用户删掉。notes.topicId 有外键约束且 foreign_keys=ON，
     直接写回会抛 FOREIGN KEY constraint failed，撤销按钮变成一个 500。 */
  it("旧主题已被删除时跳过主题恢复，不抛外键错误", async () => {
    const noteId = await seedClassified();
    const payload = await actAndTakeUndo("update_meta", { noteId, topicId: "t-new", title: "新标题" });
    getDb().delete(topics).where(eq(topics.id, "t-old")).run();

    expect(undo(payload)).toEqual({ ok: true });
    const row = noteRow(noteId);
    // 主题留在原处（t-new），其余字段照常恢复
    expect(row?.topicId).toBe("t-new");
    expect(row?.title).toBe("旧标题");
  });

  it("后台 AI 刷新 updatedAt 与摘要不影响撤销", async () => {
    const noteId = await seedClassified();
    const payload = await actAndTakeUndo("update_meta", { noteId, title: "新标题" });
    simulateAiProcessed(noteId, { summary: "AI 生成的摘要" });
    expect(undo(payload)).toEqual({ ok: true });
    expect(noteRow(noteId)?.title).toBe("旧标题");
  });
});

describe("撤销 delete_note", () => {
  async function seedAndDelete() {
    const created = await actAndTakeUndo("create_note", { content: "要删掉的笔记" });
    return await actAndTakeUndo("delete_note", { noteId: created.noteId });
  }

  it("撤销把笔记从回收站恢复", async () => {
    const payload = await seedAndDelete();
    expect(noteRow(payload.noteId)?.deletedAt).toBeTruthy();
    expect(undo(payload)).toEqual({ ok: true });
    expect(noteRow(payload.noteId)?.deletedAt).toBeNull();
  });

  it("笔记已被手动恢复时重复撤销不报错", async () => {
    const payload = await seedAndDelete();
    expect(undo(payload)).toEqual({ ok: true });
    expect(undo(payload)).toEqual({ ok: true });
  });

  it("笔记被彻底删除后撤销失败", async () => {
    const payload = await seedAndDelete();
    getDb().delete(notes).where(eq(notes.id, payload.noteId)).run();
    expect(undo(payload).ok).toBe(false);
  });

  // 恢复回收站不覆盖任何内容，所以不设指纹校验：删除期间笔记不可能被编辑
  it("不因指纹缺失而拒绝", async () => {
    const payload = await seedAndDelete();
    expect(payload.afterFingerprint).toBeUndefined();
    expect(undo(payload)).toEqual({ ok: true });
  });
});

describe("撤销的兜底", () => {
  it("未知工具返回失败而非抛出", () => {
    const r = undo({ tool: "fetch_url", noteId: "n1", before: {}, afterUpdatedAt: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fetch_url");
  });

  it("笔记不存在时返回失败", () => {
    const r = undo({
      tool: "create_note",
      noteId: "nope",
      before: {},
      afterUpdatedAt: 0,
      afterFingerprint: "deadbeef",
    });
    expect(r).toEqual({ ok: false, reason: "笔记已不存在，无法撤销" });
  });

  it("append 的 before 缺 contentLength 时拒绝执行", async () => {
    const created = await actAndTakeUndo("create_note", { content: "正文" });
    const r = undo({
      tool: "append_to_note",
      noteId: created.noteId,
      before: {},
      afterUpdatedAt: 0,
    });
    expect(r).toEqual({ ok: false, reason: "撤销信息不完整" });
  });
});
