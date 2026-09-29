import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { buildLlmMessages, parseToolPayload, type ToolLoopDeps } from "@/lib/ai/chat-loop";
import { createChatSseResponse } from "@/lib/ai/chat-stream";
import type { ToolOutcome } from "@/lib/ai/tools";
import type { StreamChunk } from "@/lib/llm";
import { wipeData } from "../helpers/db";

const CONV = "conv-test";

const text = (t: string): StreamChunk => ({ type: "text", text: t });
const toolCall = (id: string, name: string, args = "{}"): StreamChunk => ({
  type: "tool_call",
  call: { id, name, args },
});

function seedConversation() {
  const now = Date.now();
  getDb()
    .insert(conversations)
    .values({ id: CONV, scopeType: "global", scopeId: "", title: "测试", createdAt: now, updatedAt: now })
    .run();
  getDb()
    .insert(messages)
    .values({ id: "m-user", conversationId: CONV, role: "user", content: "帮我记一条", createdAt: now })
    .run();
  return now;
}

// 跑一次流并把 SSE 文本解析成事件对象数组
async function collectSse(
  rounds: StreamChunk[][],
  opts: { outcome?: ToolOutcome; startSeq?: number; sourceRefusal?: boolean; sourceNoteIds?: ReadonlySet<string> } = {},
) {
  let i = 0;
  const deps: ToolLoopDeps = {
    async *stream() {
      const round = rounds[Math.min(i, rounds.length - 1)] ?? [];
      i += 1;
      for (const c of round) yield c;
    },
    execute: async () => opts.outcome ?? { content: "工具执行完毕", summary: "做完了" },
    requiresConfirm: (name) => name === "delete_note",
  };
  const res = createChatSseResponse({
    db: getDb(),
    conversationId: CONV,
    startSeq: opts.startSeq ?? Date.now(),
    signal: new AbortController().signal,
    initial: [{ role: "user", content: "帮我记一条" }],
    deps,
    sourceRefusal: opts.sourceRefusal,
    sourceNoteIds: opts.sourceNoteIds,
  });
  const body = await res.text();
  return body
    .split("\n\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("data:"))
    .map((s) => JSON.parse(s.slice(5).trim()) as Record<string, unknown>);
}

const storedMessages = () =>
  getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, CONV))
    .orderBy(asc(messages.createdAt))
    .all();

beforeEach(() => {
  wipeData();
  seedConversation();
});

describe("工具调用的落库", () => {
  it("assistant 的调用与工具结果各落一条，配对完整", async () => {
    await collectSse([[toolCall("c1", "create_note")], [text("记好了")]]);

    const rows = storedMessages();
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant"]);

    const calls = parseToolPayload(rows[1].toolPayload);
    const result = parseToolPayload(rows[2].toolPayload);
    expect(calls).toMatchObject({ kind: "calls" });
    expect(result).toMatchObject({ kind: "result", callId: "c1", name: "create_note", ok: true });
  });

  /* 落库顺序错乱是最难查的一类故障：下次对话回灌时 tool 结果排到了
     发起它的 assistant 前面，供应商以 400 拒绝，报错却指向 tool_call_id。 */
  it("同毫秒落多条时 createdAt 仍严格递增", async () => {
    await collectSse([[toolCall("c1", "list_topics"), toolCall("c2", "search_notes")], [text("好了")]]);
    const stamps = storedMessages().map((r) => r.createdAt);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    }
  });

  it("落库后能原样重建为配对完整的 LLM 消息", async () => {
    await collectSse([[toolCall("c1", "create_note")], [text("记好了")]]);
    const rebuilt = buildLlmMessages(storedMessages());

    const assistant = rebuilt.find((m) => m.role === "assistant" && "tool_calls" in m);
    const tool = rebuilt.find((m) => m.role === "tool");
    expect(assistant).toBeDefined();
    expect(tool).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });

  it("撤销载荷随工具结果一起落库", async () => {
    await collectSse([[toolCall("c1", "create_note")], [text("好了")]], {
      outcome: {
        content: "已创建",
        summary: "新建笔记",
        undo: { tool: "create_note", noteId: "n1", before: {}, afterUpdatedAt: 1, afterFingerprint: "abc" },
      },
    });
    const payload = parseToolPayload(storedMessages()[2].toolPayload);
    expect(payload).toMatchObject({ kind: "result", undo: { noteId: "n1", afterFingerprint: "abc" } });
  });

  it("工具失败时落库标记 ok:false 且不带撤销载荷", async () => {
    await collectSse([[toolCall("c1", "read_note")], [text("没找到")]], {
      outcome: { content: "笔记不存在", error: true },
    });
    const payload = parseToolPayload(storedMessages()[2].toolPayload);
    expect(payload).toMatchObject({ kind: "result", ok: false });
    expect((payload as { undo?: unknown }).undo).toBeUndefined();
  });

  it("空轮不落库，避免历史里堆空消息", async () => {
    await collectSse([[]]);
    expect(storedMessages().map((r) => r.role)).toEqual(["user"]);
  });
});

describe("SSE 事件", () => {
  it("工具调用产出 tool_start 与 tool_end，并带上落库的 messageId", async () => {
    const events = await collectSse([[toolCall("c1", "create_note")], [text("好了")]]);
    const start = events.find((e) => e.tool_start) as { tool_start: { name: string } };
    const end = events.find((e) => e.tool_end) as {
      tool_end: { messageId: string; ok: boolean; canUndo: boolean };
    };
    expect(start.tool_start.name).toBe("create_note");
    expect(end.tool_end.ok).toBe(true);
    // messageId 要能定位到真实落库的那条，否则撤销按钮点了会 404
    expect(storedMessages().some((r) => r.id === end.tool_end.messageId)).toBe(true);
  });

  it("最后一个事件是 done 并带回会话 id", async () => {
    const events = await collectSse([[text("你好")]]);
    expect(events.at(-1)).toEqual({ done: true, conversationId: CONV });
  });
});

describe("删除确认", () => {
  it("待确认的调用落成 pending 且没有真的执行", async () => {
    const events = await collectSse([[toolCall("c1", "delete_note", '{"noteId":"n1"}')]]);

    const confirm = events.find((e) => e.confirm_required) as {
      confirm_required: { messageId: string; summary: string };
    };
    expect(confirm.confirm_required.summary).toContain("n1");

    const rows = storedMessages();
    const payload = parseToolPayload(rows.at(-1)!.toolPayload);
    expect(payload).toMatchObject({ kind: "pending", name: "delete_note" });
    expect(rows.at(-1)!.id).toBe(confirm.confirm_required.messageId);
    // 没有 tool_start / tool_end：确认前一律不执行
    expect(events.some((e) => e.tool_start)).toBe(false);
  });

  it("待确认之后的同批调用落库为未执行，保住配对", async () => {
    await collectSse([[toolCall("c1", "delete_note"), toolCall("c2", "create_note")]]);
    const rows = storedMessages();
    const payloads = rows.slice(2).map((r) => parseToolPayload(r.toolPayload));
    expect(payloads[0]).toMatchObject({ kind: "pending", callId: "c1" });
    expect(payloads[1]).toMatchObject({ kind: "result", callId: "c2", ok: false });
    // 两个调用都有配对结果，重建历史时整批可用
    expect(buildLlmMessages(rows).filter((m) => m.role === "tool")).toHaveLength(2);
  });
});

describe("轮次上限", () => {
  it("模型不停调工具时落一条提示并正常收尾", async () => {
    const events = await collectSse([[toolCall("c1", "list_topics")]]);
    expect(events.at(-1)).toMatchObject({ done: true });
    const last = storedMessages().at(-1)!;
    expect(last.role).toBe("assistant");
    expect(last.content).toContain("轮次上限");
  });
});

describe("来源拒答收口", () => {
  it("最终回答里的改写拒答会收成固定句，并按收口后的文本落库", async () => {
    const events = await collectSse(
      [[text("来源笔记中没有关于茶树种植环境的相关内容。")]],
      { sourceRefusal: true },
    );
    const deltas = events.filter((e) => e.delta).map((e) => (e.delta as string));
    expect(deltas.join("")).toContain("来源笔记中没有相关内容");
    expect(deltas.join("")).not.toContain("没有关于");
    expect(storedMessages().at(-1)?.content).toContain("来源笔记中没有相关内容");
  });

  it("带引用的回答不收成拒答", async () => {
    const answer = "羽毛球练习安排在每周二早上[^note-a]。";
    const events = await collectSse([[text(answer)]], { sourceRefusal: true });
    const deltas = events.filter((e) => e.delta).map((e) => e.delta as string);
    expect(deltas.join("")).toBe(answer);
    expect(storedMessages().at(-1)?.content).toBe(answer);
  });

  it("白名单引用的嵌题回答不收成拒答", async () => {
    const answer = "来源笔记中没有关于茶树的相关内容[^n1]。";
    const events = await collectSse([[text(answer)]], {
      sourceRefusal: true,
      sourceNoteIds: new Set(["n1"]),
    });
    const deltas = events.filter((e) => e.delta).map((e) => e.delta as string);
    expect(deltas.join("")).toBe(answer);
    expect(storedMessages().at(-1)?.content).toBe(answer);
  });

  it("工具轮过渡句不发给客户端，最终拒答仍收口", async () => {
    const events = await collectSse(
      [[text("先看看来源"), toolCall("c1", "search_notes")], [text("来源里没有茶树种植的记录。")]],
      { sourceRefusal: true },
    );
    const deltas = events.filter((e) => e.delta).map((e) => e.delta as string);
    expect(deltas.join("")).not.toContain("先看看来源");
    expect(deltas.join("")).toContain("来源笔记中没有相关内容");
    const stored = storedMessages().filter((row) => row.role === "assistant").map((row) => row.content);
    expect(stored).toContain("先看看来源");
    expect(stored.at(-1)).toContain("来源笔记中没有相关内容");
  });
});
