// 删除确认卡片的回应。发出 {confirm_required} 后 SSE 已经结束，
// 用户点击「允许」或「拒绝」时由这里接手：更新那条待确认的工具消息，
// 再以同一套循环续跑，让模型对结果作出回应。

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { buildSystemMessage, type ChatScope } from "@/lib/ai/chat-context";
import {
  buildLlmMessages,
  parseToolPayload,
  type ToolLoopDeps,
  type ToolPayload,
} from "@/lib/ai/chat-loop";
import { createChatSseResponse } from "@/lib/ai/chat-stream";
import { extractUrls } from "@/lib/ai/fetch-url";
import { getTool, runTool, toolDefs, MAX_IMAGES_PER_MESSAGE, type ToolContext } from "@/lib/ai/tools";
import { chatStream, type LlmMessage } from "@/lib/llm";
import { getToolSupport } from "@/lib/llm-config";
import { isImageGenAvailable } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

const MAX_HISTORY = 20;
const REJECTED = "用户拒绝了此操作，未执行。";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  // 待确认的工具消息 id，由 {confirm_required} 事件给出
  messageId: z.string().min(1),
  approve: z.boolean(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { conversationId, messageId, approve } = parsed.data;
  const db = getDb();

  const conv = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  const row = db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
    .get();
  if (!row) return NextResponse.json({ error: "待确认的操作不存在" }, { status: 404 });

  const pending = parseToolPayload(row.toolPayload);
  // 已经处理过的确认请求重复点击：返回 409 而非再执行一次删除
  if (pending?.kind !== "pending") {
    return NextResponse.json({ error: "该操作已处理过" }, { status: 409 });
  }

  const userUrls = db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "user")))
    .all()
    .flatMap((m) => extractUrls(m.content));

  const scopeType = conv.scopeType as ChatScope;
  const grounded = scopeType === "sources";
  const { system, allowedNoteIds, sourcesMode } = buildSystemMessage(
    scopeType,
    conv.scopeId,
    conversationId,
  );

  const toolCtx: ToolContext = {
    db,
    userUrls,
    allowedNoteIds: grounded ? new Set(allowedNoteIds ?? []) : undefined,
    imageBudget: { remaining: MAX_IMAGES_PER_MESSAGE },
    signal: req.signal,
  };
  const outcome = approve
    ? await runTool(pending.name, pending.args, toolCtx)
    : { content: REJECTED, summary: "已取消删除", error: true };

  const ok = approve && !outcome.error;
  const summary = ok
    ? (outcome.summary ?? outcome.content.slice(0, 60))
    : approve
      ? outcome.content.slice(0, 200)
      : "已取消删除";
  const resultPayload: ToolPayload = {
    kind: "result",
    callId: pending.callId,
    name: pending.name,
    args: pending.args,
    ok,
    summary,
    noteIds: outcome.noteIds,
    undo: outcome.undo,
    image: outcome.image,
  };

  // 原地更新那条 pending 消息，不新增行：新增会让 tool_calls 出现两个配对结果
  db.update(messages)
    .set({ content: outcome.content, toolPayload: JSON.stringify(resultPayload) })
    .where(eq(messages.id, messageId))
    .run();

  const history = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_HISTORY)
    .all()
    .reverse();

  const initial: LlmMessage[] = [
    { role: "system", content: system },
    ...buildLlmMessages(history),
  ];

  const tools =
    getToolSupport() === false ? [] : toolDefs({ grounded, imageGen: isImageGenAvailable(db) });
  const deps: ToolLoopDeps = {
    stream: (msgs) => chatStream(msgs, { signal: req.signal, tools }),
    execute: (call) => runTool(call.name, call.args, toolCtx),
    requiresConfirm: (name) => Boolean(getTool(name)?.requiresConfirm),
  };

  return createChatSseResponse({
    db,
    conversationId,
    startSeq: Math.max(Date.now(), (history.at(-1)?.createdAt ?? 0) + 1),
    signal: req.signal,
    initial,
    deps,
    // 执行发生在流之前，补发一条结果事件让前端把确认卡片换成操作卡片
    prelude: [
      ...(grounded
        ? [{ grounding: { noteIds: allowedNoteIds ?? [], mode: sourcesMode ?? "empty" } }]
        : []),
      {
        tool_end: {
          id: pending.callId,
          name: pending.name,
          ok,
          summary,
          noteIds: outcome.noteIds,
          messageId,
          canUndo: Boolean(outcome.undo),
          image: outcome.image,
        },
      },
    ],
  });
}
