// 把工具循环的事件流转成 SSE 响应，同时逐条落库。
// /api/chat 与 /api/chat/confirm 共用：确认后的续跑与首轮结构相同，
// 差别只在初始消息从哪儿来、以及要不要先补发一个已完成的工具结果。

import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { conversations, messages, notes } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { LlmMessage } from "@/lib/llm";
import {
  LIMIT_NOTICE,
  OVER_LIMIT_RESULT,
  SKIPPED_RESULT,
  runToolLoop,
  type ToolLoopDeps,
  type ToolPayload,
} from "./chat-loop";

export interface ChatStreamParams {
  db: DB;
  conversationId: string;
  // 落库时间戳起点，须大于该会话已有消息的最大 createdAt
  startSeq: number;
  signal: AbortSignal;
  initial: LlmMessage[];
  deps: ToolLoopDeps;
  // 循环开始前先发出的事件（确认后补发那条已执行的工具结果）
  prelude?: unknown[];
}

export function createChatSseResponse(params: ChatStreamParams): Response {
  const { db, conversationId: convId, signal, initial, deps } = params;

  /* 落库时间戳严格递增。同毫秒内落多条时若都用 Date.now()，
     按 createdAt 排序会乱序，重建历史时 tool_calls 与结果配对错位。 */
  let seq = params.startSeq;
  const nextTs = () => (seq += 1);

  function insert(role: string, content: string, payload?: ToolPayload, reasoning?: string): string {
    const id = newId();
    db.insert(messages)
      .values({
        id,
        conversationId: convId,
        role,
        content,
        toolPayload: payload ? JSON.stringify(payload) : null,
        reasoning: reasoning || null,
        createdAt: nextTs(),
      })
      .run();
    return id;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for (const ev of params.prelude ?? []) send(ev);

        for await (const ev of runToolLoop(initial, deps)) {
          switch (ev.kind) {
            case "delta":
              send({ delta: ev.text });
              break;

            case "reasoning":
              send({ reasoning: ev.text });
              break;

            case "assistant":
              /* 空轮（既无文本又无调用）不落库，避免历史里堆空消息。
                 只有思考过程没有正文的轮次同样跳过——那段思考属于
                 紧接着的工具调用轮，不该单独留一条空消息 */
              if (ev.text || ev.calls.length > 0) {
                insert(
                  "assistant",
                  ev.text,
                  ev.calls.length > 0 ? { kind: "calls", calls: ev.calls } : undefined,
                  ev.reasoning,
                );
              }
              break;

            case "tool_start":
              send({ tool_start: { id: ev.call.id, name: ev.call.name, args: ev.call.args } });
              break;

            case "tool_result": {
              const ok = !ev.outcome.error;
              const summary = ok
                ? (ev.outcome.summary ?? ev.outcome.content.slice(0, 60))
                : ev.outcome.content.slice(0, 200);
              const messageId = insert("tool", ev.outcome.content, {
                kind: "result",
                callId: ev.call.id,
                name: ev.call.name,
                args: ev.call.args,
                ok,
                summary,
                noteIds: ev.outcome.noteIds,
                undo: ev.outcome.undo,
                image: ev.outcome.image,
              });
              send({
                tool_end: {
                  id: ev.call.id,
                  name: ev.call.name,
                  ok,
                  summary,
                  noteIds: ev.outcome.noteIds,
                  messageId,
                  canUndo: Boolean(ev.outcome.undo),
                  image: ev.outcome.image,
                },
              });
              break;
            }

            case "pending_confirm": {
              const summary = describeConfirm(db, ev.call.args);
              const messageId = insert("tool", "（等待用户确认）", {
                kind: "pending",
                callId: ev.call.id,
                name: ev.call.name,
                args: ev.call.args,
                summary,
              });
              send({
                confirm_required: {
                  id: ev.call.id,
                  name: ev.call.name,
                  args: ev.call.args,
                  summary,
                  messageId,
                  conversationId: convId,
                },
              });
              break;
            }

            case "skipped": {
              const overLimit = ev.reason === "over_limit";
              insert("tool", overLimit ? OVER_LIMIT_RESULT : SKIPPED_RESULT, {
                kind: "result",
                callId: ev.call.id,
                name: ev.call.name,
                args: ev.call.args,
                ok: false,
                summary: overLimit ? "超出单轮调用数上限，未执行" : "因前一个操作待确认而未执行",
              });
              break;
            }

            case "limit_reached":
              insert("assistant", LIMIT_NOTICE);
              send({ delta: LIMIT_NOTICE });
              break;
          }
        }
        send({ done: true, conversationId: convId });
      } catch (e) {
        // 客户端中止不算错误；其余错误告知前端
        if (!signal.aborted) {
          send({ error: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        db.update(conversations)
          .set({ updatedAt: Date.now() })
          .where(eq(conversations.id, convId))
          .run();
        try {
          controller.close();
        } catch {
          // 已关闭则忽略
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 反向代理（nginx 等）禁用缓冲，保证流式到达
      "X-Accel-Buffering": "no",
    },
  });
}

// 确认卡片上的一句话。参数是模型给的原始 JSON，解析失败时给通用文案。
// 特意查一次标题：只显示 id 的话，用户根本无从判断该不该点「允许」
function describeConfirm(db: DB, args: string): string {
  try {
    const v = JSON.parse(args) as { noteId?: string };
    if (!v.noteId) return "删除笔记";
    const row = db.select({ title: notes.title }).from(notes).where(eq(notes.id, v.noteId)).get();
    if (!row) return `删除笔记 ${v.noteId}`;
    return `删除笔记「${row.title || "（无标题）"}」`;
  } catch {
    return "删除笔记";
  }
}
