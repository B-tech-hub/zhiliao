import { describe, expect, it } from "vitest";
import type { ChatMessageRow } from "@/db/schema";
import {
  LIMIT_NOTICE,
  MAX_CALLS_PER_ROUND,
  MAX_TOOL_ROUNDS,
  OVER_LIMIT_RESULT,
  OMITTED_RESULT,
  PENDING_RESULT,
  SKIPPED_RESULT,
  applyToolBudget,
  buildLlmMessages,
  parseToolPayload,
  runToolLoop,
  type LoopEvent,
  type ToolPayload,
} from "@/lib/ai/chat-loop";
import type { ToolOutcome } from "@/lib/ai/tools";
import type { LlmMessage, StreamChunk, ToolCallPart } from "@/lib/llm";

const text = (t: string): StreamChunk => ({ type: "text", text: t });
const toolCall = (id: string, name: string, args = "{}"): StreamChunk => ({
  type: "tool_call",
  call: { id, name, args },
});

/* 可编程的假模型：按轮次给出预设 chunk，并记录每轮实际收到的消息。
   轮次用尽后重复最后一组，用于测试「模型不停调工具」的超轮次分支。 */
function fakeLlm(rounds: StreamChunk[][]) {
  const seen: LlmMessage[][] = [];
  let i = 0;
  return {
    seen,
    async *stream(msgs: LlmMessage[]): AsyncIterable<StreamChunk> {
      seen.push(JSON.parse(JSON.stringify(msgs)) as LlmMessage[]);
      const round = rounds[Math.min(i, rounds.length - 1)] ?? [];
      i += 1;
      for (const c of round) yield c;
    },
  };
}

async function run(
  rounds: StreamChunk[][],
  opts: { outcome?: (call: ToolCallPart) => ToolOutcome; initial?: LlmMessage[] } = {},
) {
  const llm = fakeLlm(rounds);
  const executed: string[] = [];
  const events: LoopEvent[] = [];
  const initial = opts.initial ?? [{ role: "user" as const, content: "帮我记一条笔记" }];
  for await (const ev of runToolLoop(initial, {
    stream: (m) => llm.stream(m),
    execute: async (call) => {
      executed.push(call.name);
      return opts.outcome?.(call) ?? { content: `${call.name} 执行完毕`, summary: "摘要" };
    },
    requiresConfirm: (name) => name === "delete_note",
  })) {
    events.push(ev);
  }
  return { events, executed, seen: llm.seen };
}

const kinds = (events: LoopEvent[]) => events.map((e) => e.kind);

describe("runToolLoop", () => {
  it("模型不调工具时一轮结束，只产出文本", async () => {
    const { events, executed } = await run([[text("你"), text("好")]]);
    expect(kinds(events)).toEqual(["delta", "delta", "assistant"]);
    expect(events.at(-1)).toMatchObject({ kind: "assistant", text: "你好", calls: [] });
    expect(executed).toEqual([]);
  });

  it("工具执行后结果回灌，模型第二轮的文本继续产出", async () => {
    const { events, executed } = await run([
      [toolCall("c1", "search_notes", '{"query":"跑步"}')],
      [text("找到 3 条")],
    ]);
    expect(kinds(events)).toEqual([
      "assistant",
      "tool_start",
      "tool_result",
      "delta",
      "assistant",
    ]);
    expect(executed).toEqual(["search_notes"]);
    expect(events.at(-1)).toMatchObject({ text: "找到 3 条", calls: [] });
  });

  it("回灌的消息里 tool_calls 与 tool_call_id 成对", async () => {
    const { seen } = await run([[toolCall("c1", "list_topics")], [text("好了")]]);
    const second = seen[1];
    expect(second.at(-2)).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "list_topics", arguments: "{}" } }],
    });
    expect(second.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: "list_topics 执行完毕",
    });
  });

  it("模型在调工具的同时说了话时，文本一并进入回灌历史", async () => {
    const { seen } = await run([[text("我查一下"), toolCall("c1", "list_topics")], [text("好了")]]);
    expect(seen[1].at(-2)).toMatchObject({ role: "assistant", content: "我查一下" });
  });

  it("需确认的工具不执行，产出 pending_confirm 后结束本轮流", async () => {
    const { events, executed } = await run([[toolCall("c1", "delete_note", '{"noteId":"n1"}')]]);
    expect(kinds(events)).toEqual(["assistant", "pending_confirm"]);
    expect(executed).toEqual([]);
  });

  it("同批次里排在待确认之后的调用被跳过且不执行", async () => {
    const { events, executed } = await run([
      [toolCall("c1", "delete_note"), toolCall("c2", "create_note"), toolCall("c3", "list_topics")],
    ]);
    expect(kinds(events)).toEqual(["assistant", "pending_confirm", "skipped", "skipped"]);
    expect(executed).toEqual([]);
  });

  it("待确认之前的调用照常执行", async () => {
    const { events, executed } = await run([
      [toolCall("c1", "list_topics"), toolCall("c2", "delete_note")],
    ]);
    expect(kinds(events)).toEqual([
      "assistant",
      "tool_start",
      "tool_result",
      "pending_confirm",
    ]);
    expect(executed).toEqual(["list_topics"]);
  });

  it("工具失败的结果照样回灌，循环继续让模型自行纠正", async () => {
    const { events, seen } = await run(
      [[toolCall("c1", "read_note", '{"noteId":"nope"}')], [text("这条笔记不存在")]],
      { outcome: () => ({ content: "笔记 nope 不存在", error: true }) },
    );
    expect(kinds(events)).toContain("tool_result");
    expect(seen[1].at(-1)).toMatchObject({ role: "tool", content: "笔记 nope 不存在" });
    expect(events.at(-1)).toMatchObject({ text: "这条笔记不存在" });
  });

  it("模型持续调工具时在轮次上限停下", async () => {
    const { events, executed } = await run([[toolCall("c1", "list_topics")]]);
    expect(executed).toHaveLength(MAX_TOOL_ROUNDS);
    expect(events.at(-1)).toEqual({ kind: "limit_reached" });
  });

  it("供应商静默忽略 tools 参数时表现为一次普通问答，不会卡住", async () => {
    const { events, executed } = await run([[text("我已经帮你创建了笔记")]]);
    expect(kinds(events)).toEqual(["delta", "assistant"]);
    expect(executed).toEqual([]);
  });

  it("缺 id 的工具调用被补上可配对的 id", async () => {
    const { seen } = await run([[toolCall("", "list_topics")], [text("好了")]]);
    const assistant = seen[1].at(-2) as { tool_calls: { id: string }[] };
    const tool = seen[1].at(-1) as { tool_call_id: string };
    expect(assistant.tool_calls[0].id).toBeTruthy();
    expect(tool.tool_call_id).toBe(assistant.tool_calls[0].id);
  });

  it("同一轮的多个调用按序执行并各自回灌", async () => {
    const { events, seen } = await run([
      [toolCall("c1", "list_topics"), toolCall("c2", "search_notes")],
      [text("完成")],
    ]);
    expect(kinds(events)).toEqual([
      "assistant",
      "tool_start",
      "tool_result",
      "tool_start",
      "tool_result",
      "delta",
      "assistant",
    ]);
    expect(seen[1].filter((m) => m.role === "tool")).toHaveLength(2);
  });

  /* 轮数管不住一轮里发几十个写操作。被网页内容策反的模型可以一口气建 50 条笔记，
     虽然每条都有操作卡片可撤销，但用户得点 50 次。 */
  it("单轮调用数超过上限时，超出的部分不执行", async () => {
    const many = Array.from({ length: MAX_CALLS_PER_ROUND + 5 }, (_, i) =>
      toolCall(`c${i}`, "create_note"),
    );
    const { events, executed } = await run([many, [text("建完了")]]);

    expect(executed).toHaveLength(MAX_CALLS_PER_ROUND);
    expect(events.filter((e) => e.kind === "skipped")).toHaveLength(5);
    expect(events.filter((e) => e.kind === "skipped" && e.reason === "over_limit")).toHaveLength(5);
  });

  it("超出上限的调用仍回灌结果，保住 tool_calls 配对", async () => {
    const many = Array.from({ length: MAX_CALLS_PER_ROUND + 2 }, (_, i) =>
      toolCall(`c${i}`, "create_note"),
    );
    const { seen } = await run([many, [text("建完了")]]);
    // 每个调用都得有配对结果，否则供应商会 400 掉整个请求
    expect(seen[1].filter((m) => m.role === "tool")).toHaveLength(MAX_CALLS_PER_ROUND + 2);
    expect(seen[1].at(-1)).toMatchObject({ content: OVER_LIMIT_RESULT });
  });

  it("正常规模的批量操作不受影响", async () => {
    const batch = Array.from({ length: 12 }, (_, i) => toolCall(`c${i}`, "update_meta"));
    const { executed, events } = await run([batch, [text("归好了")]]);
    expect(executed).toHaveLength(12);
    expect(events.some((e) => e.kind === "skipped")).toBe(false);
  });

  it("待确认优先于超限：两种未执行的原因不会混淆", async () => {
    const calls = [
      toolCall("c0", "delete_note"),
      ...Array.from({ length: MAX_CALLS_PER_ROUND + 2 }, (_, i) => toolCall(`c${i + 1}`, "create_note")),
    ];
    const { events, executed } = await run([calls]);
    expect(executed).toEqual([]);
    const skipped = events.filter((e) => e.kind === "skipped");
    expect(skipped.every((e) => e.kind === "skipped" && e.reason === "pending_confirm")).toBe(true);
  });
});

describe("applyToolBudget", () => {
  const toolMsg = (content: string): LlmMessage => ({
    role: "tool",
    tool_call_id: "x",
    content,
  });

  it("总量在预算内时原样返回", () => {
    const msgs = [toolMsg("a".repeat(100)), toolMsg("b".repeat(100))];
    expect(applyToolBudget(msgs, 1000)).toEqual(msgs);
  });

  it("超预算时省略更早的工具结果，保留较新的", () => {
    const out = applyToolBudget(
      [toolMsg("老".repeat(80)), toolMsg("中".repeat(80)), toolMsg("新".repeat(80))],
      170,
    );
    expect(out[0]).toMatchObject({ content: OMITTED_RESULT });
    expect(out[1]).toMatchObject({ content: "中".repeat(80) });
    expect(out[2]).toMatchObject({ content: "新".repeat(80) });
  });

  it("最新一条即使单条超预算也保留——否则模型拿不到刚执行的结果会反复重试", () => {
    const out = applyToolBudget([toolMsg("超".repeat(500))], 100);
    expect(out[0]).toMatchObject({ content: "超".repeat(500) });
  });

  it("不改动非工具消息", () => {
    const msgs: LlmMessage[] = [
      { role: "system", content: "s".repeat(500) },
      { role: "user", content: "u".repeat(500) },
      toolMsg("t".repeat(500)),
      { role: "assistant", content: "a".repeat(500) },
    ];
    const out = applyToolBudget(msgs, 10);
    expect(out[0]).toEqual(msgs[0]);
    expect(out[1]).toEqual(msgs[1]);
    expect(out[3]).toEqual(msgs[3]);
  });
});

describe("buildLlmMessages", () => {
  let seq = 0;
  const row = (
    role: string,
    content: string,
    payload?: ToolPayload,
    reasoning?: string,
  ): ChatMessageRow => ({
    id: `m${(seq += 1)}`,
    conversationId: "conv1",
    role,
    content,
    toolPayload: payload ? JSON.stringify(payload) : null,
    reasoning: reasoning ?? null,
    createdAt: seq,
  });

  const calls = (...ids: string[]): ToolPayload => ({
    kind: "calls",
    calls: ids.map((id) => ({ id, name: "list_topics", args: "{}" })),
  });

  const result = (callId: string): ToolPayload => ({
    kind: "result",
    callId,
    name: "list_topics",
    args: "{}",
    ok: true,
    summary: "列出主题",
  });

  it("普通对话原样转换", () => {
    expect(buildLlmMessages([row("user", "你好"), row("assistant", "你好呀")])).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好呀" },
    ]);
  });

  /* 思考过程绝不回灌。DeepSeek 等供应商明确要求 reasoning_content 不得作为输入，
     带上会 400 掉整个请求——用户表现为「开了深度思考聊第二句就报错」。 */
  it("落库的思考过程不进 LLM 上下文", () => {
    const out = buildLlmMessages([
      row("user", "帮我想想"),
      row("assistant", "结论是 A", undefined, "先假设 B，推翻后得到 A"),
    ]);
    expect(out).toEqual([
      { role: "user", content: "帮我想想" },
      { role: "assistant", content: "结论是 A" },
    ]);
    expect(JSON.stringify(out)).not.toContain("推翻");
  });

  // 只想了没说话、直接调工具的那一轮：思考过程同样不能混进回灌的 content
  it("只有思考过程的工具轮不泄漏思维链", () => {
    const out = buildLlmMessages([
      row("assistant", "", calls("c1"), "我应该先查一下主题"),
      row("tool", "共 3 个主题", result("c1")),
    ]);
    expect(out[0]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "list_topics", arguments: "{}" } }],
    });
    expect(JSON.stringify(out)).not.toContain("我应该");
  });

  it("配对完整的工具回合被完整保留", () => {
    const out = buildLlmMessages([
      row("user", "有哪些主题"),
      row("assistant", "", calls("c1")),
      row("tool", "共 3 个主题", result("c1")),
      row("assistant", "有 3 个"),
    ]);
    expect(out).toEqual([
      { role: "user", content: "有哪些主题" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "list_topics", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", content: "共 3 个主题" },
      { role: "assistant", content: "有 3 个" },
    ]);
  });

  it("待确认的 pending 载荷同样算作配对结果", () => {
    const out = buildLlmMessages([
      row("assistant", "", calls("c1")),
      row("tool", PENDING_RESULT, {
        kind: "pending",
        callId: "c1",
        name: "delete_note",
        args: "{}",
        summary: "删除",
      }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });

  /* 以下三条是历史按条数截断后最容易出现的形态。
     任何一条漏掉，供应商都会以 400 拒绝整个请求，且报错指向 tool_call_id
     而非截断本身，极难定位。 */
  it("结果被截断丢失时，assistant 的 tool_calls 一并丢弃但保留文本", () => {
    const out = buildLlmMessages([row("assistant", "我查一下", calls("c1"))]);
    expect(out).toEqual([{ role: "assistant", content: "我查一下" }]);
  });

  it("结果丢失且文本为空时整条 assistant 丢弃", () => {
    expect(buildLlmMessages([row("assistant", "", calls("c1"))])).toEqual([]);
  });

  it("孤儿工具结果（发起它的 assistant 已被截断）不发出", () => {
    const out = buildLlmMessages([row("tool", "共 3 个主题", result("c1")), row("assistant", "有 3 个")]);
    expect(out).toEqual([{ role: "assistant", content: "有 3 个" }]);
  });

  it("一批调用只有部分结果时整批丢弃", () => {
    const out = buildLlmMessages([
      row("assistant", "我查一下", calls("c1", "c2")),
      row("tool", "共 3 个主题", result("c1")),
    ]);
    expect(out).toEqual([{ role: "assistant", content: "我查一下" }]);
  });

  it("载荷损坏时按普通消息处理，不让会话打不开", () => {
    const broken: ChatMessageRow = { ...row("assistant", "文字还在"), toolPayload: "{不是JSON" };
    expect(buildLlmMessages([broken])).toEqual([{ role: "assistant", content: "文字还在" }]);
  });
});

describe("parseToolPayload", () => {
  it("空值与非法 JSON 返回 null", () => {
    expect(parseToolPayload(null)).toBeNull();
    expect(parseToolPayload("")).toBeNull();
    expect(parseToolPayload("{坏")).toBeNull();
  });

  it("缺少判别字段的载荷返回 null", () => {
    expect(parseToolPayload('{"foo":1}')).toBeNull();
    expect(parseToolPayload('{"kind":"result"}')).toBeNull();
    expect(parseToolPayload('{"kind":"calls"}')).toBeNull();
  });
});

describe("循环产出的提示文案", () => {
  it("待确认、被跳过、省略、超限四种提示各不相同", () => {
    const all = [PENDING_RESULT, SKIPPED_RESULT, OMITTED_RESULT, LIMIT_NOTICE];
    expect(new Set(all).size).toBe(4);
  });
});
