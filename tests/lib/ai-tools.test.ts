import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/db";
import { aiJobs, notes, topics } from "@/db/schema";
import { runTool, toolDefs, ASSISTANT_TOOLS } from "@/lib/ai/tools";
import type { ToolContext } from "@/lib/ai/tools";
import { getTagsForNotes } from "@/lib/notes";
import { insertTopic, wipeData } from "../helpers/db";

const ctx = (): ToolContext => ({ db: getDb(), userUrls: [] });

// 直接给出 JSON 字符串，与模型真实产出的形态一致
const call = (name: string, args: Record<string, unknown> = {}) =>
  runTool(name, JSON.stringify(args), ctx());

function noteRow(id: string) {
  return getDb().select().from(notes).where(eq(notes.id, id)).get();
}

/* 直接查 FTS 影子表。不能靠 search_notes 的结果反推同步是否正常——
   searchNoteIds 在 MATCH 无结果时会降级为 LIKE 全表扫描，
   即使 FTS 完全没写也照样搜得到，这条掩盖会让断言失效。 */
function ftsRow(noteId: string) {
  return getSqlite()
    .prepare("SELECT title_seg, content_seg, tags_seg FROM notes_fts WHERE note_id = ?")
    .get(noteId) as { title_seg: string; content_seg: string; tags_seg: string } | undefined;
}

beforeEach(() => {
  wipeData();
});

describe("工具注册表", () => {
  it("9 个工具齐备，且 JSON Schema 可用于 function calling", () => {
    expect(ASSISTANT_TOOLS.map((t) => t.name).sort()).toEqual([
      "append_to_note",
      "create_note",
      "delete_note",
      "fetch_url",
      "generate_image",
      "list_topics",
      "read_note",
      "search_notes",
      "update_meta",
    ]);
    for (const def of toolDefs({ imageGen: true })) {
      expect(def.type).toBe("function");
      expect(def.function.description.length).toBeGreaterThan(10);
      expect(def.function.parameters).toHaveProperty("type", "object");
      // $schema 会被个别供应商拒绝，defineTool 里已剥掉
      expect(def.function.parameters).not.toHaveProperty("$schema");
    }
  });

  /* 没配图像模型时不下发生图工具：发了模型照调不误，收到「未配置」错误后
     还要多花一轮向用户道歉，而用户根本没提过画图。 */
  it("未配置图像模型时不下发 generate_image", () => {
    expect(toolDefs().map((d) => d.function.name)).not.toContain("generate_image");
    expect(toolDefs({ imageGen: true }).map((d) => d.function.name)).toContain("generate_image");
  });

  it("正文覆盖工具不存在（ADR-0007 不做版本历史，覆盖不可恢复）", () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name);
    expect(names).not.toContain("update_note");
    expect(names).not.toContain("replace_content");
  });

  // 生图不可撤销也要保持这条不变量：代价一侧由张数封顶来管，不靠确认卡片
  it("只有 delete_note 需要用户确认", () => {
    expect(ASSISTANT_TOOLS.filter((t) => t.requiresConfirm).map((t) => t.name)).toEqual([
      "delete_note",
    ]);
  });
});

describe("runTool 的容错", () => {
  it("未知工具返回错误结果而非抛出", async () => {
    const r = await call("no_such_tool");
    expect(r.error).toBe(true);
    expect(r.content).toContain("不存在名为");
  });

  it("参数不是合法 JSON 时返回错误结果", async () => {
    const r = await runTool("read_note", "{坏JSON", ctx());
    expect(r.error).toBe(true);
    expect(r.content).toContain("合法 JSON");
  });

  it("参数不符合 schema 时返回错误结果", async () => {
    const r = await call("read_note", { noteId: "" });
    expect(r.error).toBe(true);
    expect(r.content).toContain("参数不合法");
  });

  it("笔记不存在时返回错误结果，供模型自行纠正", async () => {
    const r = await call("read_note", { noteId: "nope" });
    expect(r.error).toBe(true);
    expect(r.content).toContain("不存在");
  });
});

describe("create_note", () => {
  it("新建后写入 FTS 索引，并能被 search_notes 搜到", async () => {
    const created = await call("create_note", { content: "今天晨跑了五公里，配速六分" });
    expect(created.error).toBeUndefined();
    const noteId = created.noteIds?.[0];
    expect(noteId).toBeTruthy();

    // FTS 影子表必须同步写入（LIKE 降级会掩盖漏写，所以直接查表）
    expect(ftsRow(noteId!)?.content_seg).toContain("晨跑");

    const found = await call("search_notes", { query: "晨跑" });
    expect(found.noteIds).toContain(noteId);
    expect(found.content).toContain("晨跑");
  });

  it("入队 AI 处理任务", async () => {
    const created = await call("create_note", { content: "一条待整理的笔记" });
    const job = getDb()
      .select()
      .from(aiJobs)
      .where(and(eq(aiJobs.noteId, created.noteIds![0]), eq(aiJobs.type, "note_process")))
      .get();
    expect(job?.status).toBe("pending");
  });

  it("指定主题视为手动归类并锁定主题", async () => {
    insertTopic("t1", "运动");
    const created = await call("create_note", { content: "跑步记录", topicId: "t1" });
    const row = noteRow(created.noteIds![0]);
    expect(row?.topicId).toBe("t1");
    expect(row?.topicLocked).toBe(1);
  });

  it("主题不存在时报错且不写入", async () => {
    const r = await call("create_note", { content: "x", topicId: "ghost" });
    expect(r.error).toBe(true);
    expect(getDb().select().from(notes).all()).toHaveLength(0);
  });

  it("产出可撤销的操作载荷", async () => {
    const created = await call("create_note", { content: "撤销测试" });
    expect(created.undo).toMatchObject({ tool: "create_note", noteId: created.noteIds![0] });
    expect(created.undo?.afterUpdatedAt).toBeTypeOf("number");
    expect(created.summary).toContain("新建笔记");
  });
});

describe("append_to_note", () => {
  it("追加到正文末尾，并记录截回所需的长度", async () => {
    const created = await call("create_note", { content: "购物清单" });
    const noteId = created.noteIds![0];

    const appended = await call("append_to_note", { noteId, text: "- 牛奶" });
    expect(appended.error).toBeUndefined();
    const row = noteRow(noteId);
    expect(row?.content).toBe("购物清单\n\n- 牛奶");
    // 撤销时按此长度截回，恰好还原追加前的正文
    expect(row!.content.slice(0, appended.undo!.before.contentLength as number)).toBe("购物清单");
  });

  it("追加后重新入队 AI 处理（与手动编辑正文同一语义）", async () => {
    const created = await call("create_note", { content: "原文" });
    const noteId = created.noteIds![0];
    getDb().update(notes).set({ aiStatus: "done" }).where(eq(notes.id, noteId)).run();

    await call("append_to_note", { noteId, text: "补充" });
    expect(noteRow(noteId)?.aiStatus).toBe("pending");
  });

  it("追加后 FTS 索引同步刷新，新内容可被搜到", async () => {
    const created = await call("create_note", { content: "会议纪要" });
    await call("append_to_note", { noteId: created.noteIds![0], text: "决议：下周启动灰度发布" });
    expect(ftsRow(created.noteIds![0])?.content_seg).toContain("灰度");
    const found = await call("search_notes", { query: "灰度发布" });
    expect(found.noteIds).toContain(created.noteIds![0]);
  });

  it("笔记在回收站时拒绝追加", async () => {
    const created = await call("create_note", { content: "待删" });
    await call("delete_note", { noteId: created.noteIds![0] });
    const r = await call("append_to_note", { noteId: created.noteIds![0], text: "x" });
    expect(r.error).toBe(true);
  });
});

describe("update_meta", () => {
  it("改主题/标题/标签并置锁，AI 不再覆盖", async () => {
    insertTopic("t1", "运动");
    const created = await call("create_note", { content: "跑步日志" });
    const noteId = created.noteIds![0];

    const r = await call("update_meta", {
      noteId,
      topicId: "t1",
      title: "五公里晨跑",
      tags: ["跑步", "健身"],
    });
    expect(r.error).toBeUndefined();

    const row = noteRow(noteId);
    expect(row).toMatchObject({
      topicId: "t1",
      title: "五公里晨跑",
      topicLocked: 1,
      titleLocked: 1,
      tagsLocked: 1,
    });
    expect(getTagsForNotes(getDb(), [noteId]).get(noteId)?.sort()).toEqual(["健身", "跑步"]);
    // 标签也进 FTS，改完要能按标签搜到
    expect(ftsRow(noteId)?.tags_seg).toContain("健身");
    expect(ftsRow(noteId)?.title_seg).toContain("晨跑");
  });

  it("撤销载荷带上旧值与旧锁位（只恢复值会让笔记永久失去自动整理）", async () => {
    insertTopic("t1", "运动");
    const created = await call("create_note", { content: "笔记" });
    const noteId = created.noteIds![0];
    const before = noteRow(noteId)!;

    const r = await call("update_meta", { noteId, topicId: "t1", title: "新标题" });
    expect(r.undo?.before).toMatchObject({
      topicId: before.topicId,
      title: before.title,
      tags: [],
      topicLocked: 0,
      titleLocked: 0,
      tagsLocked: 0,
    });
  });

  it("一项都不改时报错", async () => {
    const created = await call("create_note", { content: "笔记" });
    const r = await call("update_meta", { noteId: created.noteIds![0] });
    expect(r.error).toBe(true);
    expect(r.content).toContain("至少要指定");
  });

  it("主题不存在时报错且不改动笔记", async () => {
    const created = await call("create_note", { content: "笔记" });
    const noteId = created.noteIds![0];
    const before = noteRow(noteId)!;
    const r = await call("update_meta", { noteId, topicId: "ghost" });
    expect(r.error).toBe(true);
    expect(noteRow(noteId)).toMatchObject({ topicId: before.topicId, updatedAt: before.updatedAt });
  });
});

describe("delete_note", () => {
  it("移入回收站而非物理删除，并移出 FTS 索引", async () => {
    const created = await call("create_note", { content: "临时记录的实验数据" });
    const noteId = created.noteIds![0];
    expect(ftsRow(noteId)).toBeTruthy();

    const r = await call("delete_note", { noteId });
    expect(r.error).toBeUndefined();
    const row = noteRow(noteId);
    expect(row).toBeTruthy(); // 行还在，30 天内可恢复
    expect(row?.deletedAt).toBeTypeOf("number");
    // 回收站笔记必须移出 FTS，否则搜索会命中用户已看不到的内容
    expect(ftsRow(noteId)).toBeUndefined();

    const found = await call("search_notes", { query: "实验数据" });
    expect(found.noteIds ?? []).not.toContain(noteId);
  });

  it("撤销基准沿用删除前的 updatedAt（trashNotes 刻意不改它）", async () => {
    const created = await call("create_note", { content: "笔记" });
    const noteId = created.noteIds![0];
    const before = noteRow(noteId)!;
    const r = await call("delete_note", { noteId });
    expect(r.undo).toMatchObject({ tool: "delete_note", noteId, afterUpdatedAt: before.updatedAt });
  });

  it("删除已在回收站的笔记时报错", async () => {
    const created = await call("create_note", { content: "笔记" });
    await call("delete_note", { noteId: created.noteIds![0] });
    const r = await call("delete_note", { noteId: created.noteIds![0] });
    expect(r.error).toBe(true);
  });
});

describe("search_notes / read_note / list_topics", () => {
  it("搜不到时给出明确提示而非空结果", async () => {
    const r = await call("search_notes", { query: "根本不存在的词" });
    expect(r.error).toBeUndefined();
    expect(r.content).toContain("没有找到");
    expect(r.noteIds).toEqual([]);
  });

  it("read_note 返回标题、主题、标签与正文", async () => {
    insertTopic("t1", "运动");
    const created = await call("create_note", { content: "正文内容在此", topicId: "t1" });
    const noteId = created.noteIds![0];
    await call("update_meta", { noteId, title: "我的标题", tags: ["标签甲"] });

    const r = await call("read_note", { noteId });
    expect(r.content).toContain("我的标题");
    expect(r.content).toContain("运动");
    expect(r.content).toContain("标签甲");
    expect(r.content).toContain("正文内容在此");
    expect(r.noteIds).toEqual([noteId]);
  });

  it("read_note 截断超长正文", async () => {
    const created = await call("create_note", { content: "长".repeat(9000) });
    const r = await call("read_note", { noteId: created.noteIds![0] });
    expect(r.content).toContain("已截断");
    expect(r.content.length).toBeLessThan(9000);
  });

  it("list_topics 含系统主题与笔记计数", async () => {
    insertTopic("t1", "运动");
    await call("create_note", { content: "跑步", topicId: "t1" });
    const r = await call("list_topics");
    expect(r.content).toContain("topicId: t1");
    expect(r.content).toContain("笔记数: 1");
    // 未分类是系统主题，模型需要知道它不可删改
    expect(r.content).toContain("系统主题");
  });

  it("list_topics 在没有笔记的主题上计数为 0", async () => {
    insertTopic("t2", "空主题");
    const r = await call("list_topics");
    expect(r.content).toMatch(/名称: 空主题｜笔记数: 0/);
    expect(getDb().select().from(topics).all().length).toBeGreaterThan(1);
  });
});

describe("fetch_url 工具层", () => {
  it("用户未在对话中给出的网址被拒（不触发任何网络请求）", async () => {
    const r = await runTool("fetch_url", JSON.stringify({ url: "https://evil.test/x" }), {
      db: getDb(),
      userUrls: [],
    });
    expect(r.error).toBe(true);
    expect(r.content).toContain("未在本次对话中出现");
  });

  it("非 http(s) 协议被拒", async () => {
    const r = await runTool("fetch_url", JSON.stringify({ url: "file:///etc/passwd" }), {
      db: getDb(),
      userUrls: ["file:///etc/passwd"],
    });
    expect(r.error).toBe(true);
  });
});
