import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { conversations, conversationSources } from "@/db/schema";
import {
  buildSourcesContext,
  describeSources,
  getConversationSources,
  MAX_SOURCES_CHARS,
  resolveSourceNotes,
  setConversationSources,
} from "@/lib/ai/sources";
import { buildSystemMessage, SOURCES_SYSTEM_PROMPT } from "@/lib/ai/chat-context";
import { runTool, toolDefs, GROUNDED_BLOCKED_TOOLS } from "@/lib/ai/tools";
import type { ToolContext } from "@/lib/ai/tools";
import { refreshNoteFts } from "@/lib/search";
import { insertNote, insertTopic, wipeData } from "../helpers/db";

function seedConversation(id: string, scopeType = "sources") {
  const now = Date.now();
  getDb()
    .insert(conversations)
    .values({ id, scopeType, scopeId: "", title: "", createdAt: now, updatedAt: now })
    .run();
}

function addSource(convId: string, type: "note" | "topic", id: string) {
  getDb()
    .insert(conversationSources)
    .values({ conversationId: convId, sourceType: type, sourceId: id, createdAt: Date.now() })
    .run();
}

beforeEach(() => wipeData());

describe("来源集读写", () => {
  it("覆盖式写入去重，读回保持写入顺序", () => {
    seedConversation("c1");
    setConversationSources(getDb(), "c1", [
      { type: "note", id: "n1" },
      { type: "topic", id: "t1" },
      { type: "note", id: "n1" },
    ]);
    expect(getConversationSources(getDb(), "c1")).toEqual([
      { type: "note", id: "n1" },
      { type: "topic", id: "t1" },
    ]);

    setConversationSources(getDb(), "c1", [{ type: "note", id: "n2" }]);
    expect(getConversationSources(getDb(), "c1")).toEqual([{ type: "note", id: "n2" }]);
  });

  it("describeSources 标出回收站与已彻底删除的来源", () => {
    insertNote("n1", "正常", { title: "存活笔记" });
    insertNote("n2", "已删", { title: "回收站笔记", deletedAt: Date.now() });
    insertTopic("t1", "存活主题");
    const items = describeSources(getDb(), [
      { type: "note", id: "n1" },
      { type: "note", id: "n2" },
      { type: "note", id: "ghost" },
      { type: "topic", id: "t1" },
      { type: "topic", id: "ghost-topic" },
    ]);
    expect(items.map((i) => [i.label, i.deleted ?? false, i.missing ?? false])).toEqual([
      ["存活笔记", false, false],
      ["回收站笔记", true, false],
      ["（已删除的笔记）", false, true],
      ["存活主题", false, false],
      ["（已删除的主题）", false, true],
    ]);
  });
});

describe("来源集展开", () => {
  it("主题是活引用——主题下后加的笔记自动进入来源范围", () => {
    insertTopic("t1", "主题一");
    insertNote("n1", "旧笔记", { topicId: "t1" });
    const refs = [{ type: "topic" as const, id: "t1" }];
    expect(resolveSourceNotes(getDb(), refs).map((r) => r.id)).toEqual(["n1"]);

    insertNote("n2", "新笔记", { topicId: "t1" });
    expect(resolveSourceNotes(getDb(), refs).map((r) => r.id).sort()).toEqual(["n1", "n2"]);
  });

  it("回收站笔记不展开（引用还在，恢复后自动回来）", () => {
    insertTopic("t1", "主题一");
    insertNote("n1", "存活", { topicId: "t1" });
    insertNote("n2", "已删", { topicId: "t1", deletedAt: Date.now() });
    insertNote("n3", "直接勾选但已删", { deletedAt: Date.now() });
    const rows = resolveSourceNotes(getDb(), [
      { type: "topic", id: "t1" },
      { type: "note", id: "n3" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["n1"]);
  });

  it("笔记同时被直接勾选与随主题带入时只出现一次", () => {
    insertTopic("t1", "主题一");
    insertNote("n1", "内容", { topicId: "t1" });
    const rows = resolveSourceNotes(getDb(), [
      { type: "note", id: "n1" },
      { type: "topic", id: "t1" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["n1"]);
  });
});

describe("来源上下文注入", () => {
  it("预算内注入全文，白名单为全部来源笔记", () => {
    seedConversation("c1");
    insertNote("n1", "光合作用发生在叶绿体中。", { title: "植物学" });
    addSource("c1", "note", "n1");

    const r = buildSourcesContext(getDb(), "c1");
    expect(r.mode).toBe("full");
    expect(r.context).toContain("光合作用发生在叶绿体中。");
    expect(r.context).toContain("noteId: n1");
    expect(r.allowedNoteIds).toEqual(["n1"]);
  });

  it("超预算改注入清单，白名单不变（正文交给限域工具取）", () => {
    seedConversation("c1");
    const long = "字".repeat(MAX_SOURCES_CHARS);
    insertNote("n1", long, { title: "超长笔记", summary: "一句话摘要" });
    insertNote("n2", "短笔记正文", { title: "短笔记" });
    addSource("c1", "note", "n1");
    addSource("c1", "note", "n2");

    const r = buildSourcesContext(getDb(), "c1");
    expect(r.mode).toBe("digest");
    expect(r.context).not.toContain(long);
    expect(r.context).toContain("一句话摘要");
    expect(r.context.length).toBeLessThan(MAX_SOURCES_CHARS);
    expect(r.allowedNoteIds.sort()).toEqual(["n1", "n2"]);
  });

  it("来源全部失效时给出空来源提示，白名单为空数组而非未限域", () => {
    seedConversation("c1");
    insertNote("n1", "内容", { deletedAt: Date.now() });
    addSource("c1", "note", "n1");

    const r = buildSourcesContext(getDb(), "c1");
    expect(r.mode).toBe("empty");
    expect(r.allowedNoteIds).toEqual([]);

    const sys = buildSystemMessage("sources", "", "c1");
    expect(sys.system).toContain(SOURCES_SYSTEM_PROMPT);
    expect(sys.system).toContain("来源集为空");
    expect(sys.allowedNoteIds).toEqual([]);
  });

  it("来源问答的 system prompt 带严格接地约束，且不误用「当前正在查看的主题」文案", () => {
    seedConversation("c1");
    insertNote("n1", "内容", { title: "笔记一" });
    addSource("c1", "note", "n1");

    const sys = buildSystemMessage("sources", "", "c1");
    expect(sys.system).toContain("来源笔记中没有相关内容");
    expect(sys.system).not.toContain("用户当前正在查看的");
    expect(sys.allowedNoteIds).toEqual(["n1"]);
  });
});

describe("工具限域", () => {
  const groundedCtx = (allowed: string[]): ToolContext => ({
    db: getDb(),
    userUrls: [],
    allowedNoteIds: new Set(allowed),
  });

  it("来源问答不下发 fetch_url，模型硬调也会被执行层拦下", async () => {
    const names = toolDefs({ grounded: true }).map((d) => d.function.name);
    expect(names).not.toContain("fetch_url");
    expect(names).toContain("create_note");
    expect(names).toContain("search_notes");
    expect(GROUNDED_BLOCKED_TOOLS.has("fetch_url")).toBe(true);

    const r = await runTool(
      "fetch_url",
      JSON.stringify({ url: "https://example.com" }),
      groundedCtx(["n1"]),
    );
    expect(r.error).toBe(true);
    expect(r.content).toContain("来源问答模式下不能使用");
  });

  /* 生图与 fetch_url 同置：图必然出自模型自己的画风与世界知识，
     不可能只依据来源。配了图像模型也不放行——限域优先于能力可用性。 */
  it("来源问答不下发 generate_image，配了图像模型也不放行", async () => {
    expect(GROUNDED_BLOCKED_TOOLS.has("generate_image")).toBe(true);
    const names = toolDefs({ grounded: true, imageGen: true }).map((d) => d.function.name);
    expect(names).not.toContain("generate_image");

    const r = await runTool(
      "generate_image",
      JSON.stringify({ prompt: "一只猫" }),
      groundedCtx(["n1"]),
    );
    expect(r.error).toBe(true);
    expect(r.content).toContain("来源问答模式下不能使用");
  });

  it("read_note 越界读取被拒，来源内正常读取", async () => {
    insertNote("n1", "来源内容", { title: "在来源里" });
    insertNote("n2", "库里其他笔记", { title: "不在来源里" });
    refreshNoteFts(getDb(), "n1");
    refreshNoteFts(getDb(), "n2");

    const ok = await runTool("read_note", JSON.stringify({ noteId: "n1" }), groundedCtx(["n1"]));
    expect(ok.error).toBeUndefined();
    expect(ok.content).toContain("来源内容");

    const denied = await runTool("read_note", JSON.stringify({ noteId: "n2" }), groundedCtx(["n1"]));
    expect(denied.error).toBe(true);
    expect(denied.content).toContain("不在本次对话的来源集内");
  });

  it("search_notes 只返回来源集内的命中", async () => {
    insertNote("n1", "光合作用与叶绿体", { title: "植物学笔记" });
    insertNote("n2", "光合作用的另一篇", { title: "另一篇植物学" });
    refreshNoteFts(getDb(), "n1");
    refreshNoteFts(getDb(), "n2");

    const r = await runTool(
      "search_notes",
      JSON.stringify({ query: "光合作用" }),
      groundedCtx(["n1"]),
    );
    expect(r.noteIds).toEqual(["n1"]);
    expect(r.content).not.toContain("n2");
  });

  it("来源集为空时搜不到任何笔记（空白名单不等于不限域）", async () => {
    insertNote("n1", "光合作用与叶绿体", { title: "植物学笔记" });
    refreshNoteFts(getDb(), "n1");

    const r = await runTool("search_notes", JSON.stringify({ query: "光合作用" }), groundedCtx([]));
    expect(r.noteIds).toEqual([]);
    expect(r.content).toContain("来源集中没有找到");
  });

  it("普通对话不受限域影响", async () => {
    insertNote("n1", "内容", { title: "笔记一" });
    const ctx: ToolContext = { db: getDb(), userUrls: [] };
    const r = await runTool("read_note", JSON.stringify({ noteId: "n1" }), ctx);
    expect(r.error).toBeUndefined();
    expect(toolDefs().map((d) => d.function.name)).toContain("fetch_url");
  });
});
