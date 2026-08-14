import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages, notes } from "@/db/schema";
import { POST as confirmPost } from "@/app/api/chat/confirm/route";
import { POST as undoPost } from "@/app/api/chat/undo/route";
import { parseToolPayload, type ToolPayload } from "@/lib/ai/chat-loop";
import { runTool, type ToolContext, type UndoPayload } from "@/lib/ai/tools";
import { wipeData } from "../helpers/db";

const CONV = "conv-confirm";

// 模型收到工具结果后的收尾回复，供 confirm 的续跑消费
function sseResponse(text: string) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(body));
        c.close();
      },
    }),
    text: async () => "",
  };
}

function post(handler: typeof confirmPost, url: string, body: unknown) {
  return handler(
    new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const rows = () =>
  getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, CONV))
    .orderBy(asc(messages.createdAt))
    .all();

// 造一个「模型请求删除、等待确认」的现场
function seedPendingDelete(noteId: string) {
  const db = getDb();
  const now = Date.now();
  db.insert(conversations)
    .values({ id: CONV, scopeType: "global", scopeId: "", title: "删除", createdAt: now, updatedAt: now })
    .run();
  db.insert(messages)
    .values({ id: "m1", conversationId: CONV, role: "user", content: "删掉那条笔记", createdAt: now })
    .run();
  const calls: ToolPayload = {
    kind: "calls",
    calls: [{ id: "c1", name: "delete_note", args: JSON.stringify({ noteId }) }],
  };
  db.insert(messages)
    .values({
      id: "m2",
      conversationId: CONV,
      role: "assistant",
      content: "",
      toolPayload: JSON.stringify(calls),
      createdAt: now + 1,
    })
    .run();
  const pending: ToolPayload = {
    kind: "pending",
    callId: "c1",
    name: "delete_note",
    args: JSON.stringify({ noteId }),
    summary: `删除笔记 ${noteId}`,
  };
  db.insert(messages)
    .values({
      id: "m3",
      conversationId: CONV,
      role: "tool",
      content: "（等待用户确认）",
      toolPayload: JSON.stringify(pending),
      createdAt: now + 2,
    })
    .run();
}

async function seedNote(content: string) {
  const outcome = await runTool("create_note", JSON.stringify({ content }), {
    db: getDb(),
    userUrls: [],
  } satisfies ToolContext);
  return (outcome.undo as UndoPayload).noteId;
}

const noteRow = (id: string) => getDb().select().from(notes).where(eq(notes.id, id)).get();

beforeEach(() => {
  wipeData();
  vi.stubGlobal("fetch", vi.fn(async () => sseResponse("好的")));
});

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/chat/confirm", () => {
  it("允许后执行删除，笔记进回收站", async () => {
    const noteId = await seedNote("要删掉的笔记");
    seedPendingDelete(noteId);

    const res = await post(confirmPost, "http://x/api/chat/confirm", {
      conversationId: CONV,
      messageId: "m3",
      approve: true,
    });
    await res.text();

    expect(noteRow(noteId)?.deletedAt).toBeTruthy();
  });

  /* 必须原地更新那条 pending，不能新增一行：
     新增会让同一个 tool_call 出现两个配对结果，下次回灌被供应商拒绝。 */
  it("结果原地写回待确认的那条消息，不新增行", async () => {
    const noteId = await seedNote("要删掉的笔记");
    seedPendingDelete(noteId);
    const before = rows().length;

    const res = await post(confirmPost, "http://x/api/chat/confirm", {
      conversationId: CONV,
      messageId: "m3",
      approve: true,
    });
    await res.text();

    const after = rows();
    const updated = after.find((r) => r.id === "m3")!;
    expect(parseToolPayload(updated.toolPayload)).toMatchObject({
      kind: "result",
      callId: "c1",
      ok: true,
    });
    // 新增的只该是模型收尾那条 assistant
    expect(after.filter((r) => r.role === "tool")).toHaveLength(1);
    expect(after.length).toBe(before + 1);
  });

  it("拒绝时不执行删除，但把拒绝结果回灌给模型", async () => {
    const noteId = await seedNote("要保留的笔记");
    seedPendingDelete(noteId);

    const res = await post(confirmPost, "http://x/api/chat/confirm", {
      conversationId: CONV,
      messageId: "m3",
      approve: false,
    });
    await res.text();

    expect(noteRow(noteId)?.deletedAt).toBeNull();
    const updated = rows().find((r) => r.id === "m3")!;
    expect(updated.content).toContain("拒绝");
    expect(parseToolPayload(updated.toolPayload)).toMatchObject({ kind: "result", ok: false });
    // 拒绝同样续跑一轮，让模型有机会回应「已取消」
    expect(rows().some((r) => r.role === "assistant" && r.content === "好的")).toBe(true);
  });

  it("补发一条 tool_end，前端据此把确认卡片换成操作卡片", async () => {
    const noteId = await seedNote("要删掉的笔记");
    seedPendingDelete(noteId);

    const res = await post(confirmPost, "http://x/api/chat/confirm", {
      conversationId: CONV,
      messageId: "m3",
      approve: true,
    });
    const body = await res.text();
    const first = JSON.parse(body.split("\n\n")[0].replace("data:", "").trim());
    expect(first).toMatchObject({ tool_end: { id: "c1", name: "delete_note", ok: true } });
  });

  it("重复确认返回 409，不会删第二次", async () => {
    const noteId = await seedNote("要删掉的笔记");
    seedPendingDelete(noteId);
    await (
      await post(confirmPost, "http://x/api/chat/confirm", {
        conversationId: CONV,
        messageId: "m3",
        approve: true,
      })
    ).text();

    const again = await post(confirmPost, "http://x/api/chat/confirm", {
      conversationId: CONV,
      messageId: "m3",
      approve: true,
    });
    expect(again.status).toBe(409);
  });

  it("消息不属于该会话时返回 404", async () => {
    const noteId = await seedNote("笔记");
    seedPendingDelete(noteId);
    const res = await post(confirmPost, "http://x/api/chat/confirm", {
      conversationId: CONV,
      messageId: "不存在",
      approve: true,
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/chat/undo", () => {
  // 造一条「已执行且可撤销」的工具消息
  async function seedUndoable() {
    const db = getDb();
    const now = Date.now();
    db.insert(conversations)
      .values({ id: CONV, scopeType: "global", scopeId: "", title: "建", createdAt: now, updatedAt: now })
      .run();
    const outcome = await runTool("create_note", JSON.stringify({ content: "助手建的笔记" }), {
      db,
      userUrls: [],
    } satisfies ToolContext);
    const payload: ToolPayload = {
      kind: "result",
      callId: "c1",
      name: "create_note",
      args: "{}",
      ok: true,
      summary: "新建笔记",
      undo: outcome.undo,
    };
    db.insert(messages)
      .values({
        id: "m-tool",
        conversationId: CONV,
        role: "tool",
        content: outcome.content,
        toolPayload: JSON.stringify(payload),
        createdAt: now + 1,
      })
      .run();
    return (outcome.undo as UndoPayload).noteId;
  }

  it("撤销后笔记进回收站，并标记为已撤销", async () => {
    const noteId = await seedUndoable();
    const res = await post(undoPost, "http://x/api/chat/undo", { messageId: "m-tool" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(noteRow(noteId)?.deletedAt).toBeTruthy();
    expect(parseToolPayload(rows()[0].toolPayload)).toMatchObject({ undone: true });
  });

  it("重复撤销不再执行反向操作", async () => {
    await seedUndoable();
    await post(undoPost, "http://x/api/chat/undo", { messageId: "m-tool" });
    const again = await post(undoPost, "http://x/api/chat/undo", { messageId: "m-tool" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, reason: "已撤销过" });
  });

  it("笔记被改过时返回 409 且不动数据", async () => {
    const noteId = await seedUndoable();
    getDb().update(notes).set({ content: "用户改过了" }).where(eq(notes.id, noteId)).run();

    const res = await post(undoPost, "http://x/api/chat/undo", { messageId: "m-tool" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(noteRow(noteId)?.deletedAt).toBeNull();
  });

  it("不可撤销的消息返回 400", async () => {
    const db = getDb();
    const now = Date.now();
    db.insert(conversations)
      .values({ id: CONV, scopeType: "global", scopeId: "", title: "查", createdAt: now, updatedAt: now })
      .run();
    const payload: ToolPayload = {
      kind: "result",
      callId: "c1",
      name: "search_notes",
      args: "{}",
      ok: true,
      summary: "检索",
    };
    db.insert(messages)
      .values({
        id: "m-read",
        conversationId: CONV,
        role: "tool",
        content: "找到 3 条",
        toolPayload: JSON.stringify(payload),
        createdAt: now,
      })
      .run();

    const res = await post(undoPost, "http://x/api/chat/undo", { messageId: "m-read" });
    expect(res.status).toBe(400);
  });

  it("消息不存在返回 404", async () => {
    const res = await post(undoPost, "http://x/api/chat/undo", { messageId: "无此消息" });
    expect(res.status).toBe(404);
  });
});
