// 工具调用循环：把「模型发出调用 → 执行 → 结果回灌 → 再问模型」这条链路
// 从 HTTP/SSE 里剥出来。依赖以注入形式给出，循环本身不碰网络也不碰数据库，
// 六条分支（无调用 / 有调用 / 待确认 / 被跳过 / 超轮次 / 预算超限）都能直接断言。

import type { ChatMessageRow } from "@/db/schema";
import type { ToolOutcome, UndoPayload } from "@/lib/ai/tools";
import type { LlmMessage, StreamChunk, ToolCallPart, ToolCallRequest } from "@/lib/llm";

// 轮次上限：模型陷入「调工具 → 结果不满意 → 再调」的循环时兜底
export const MAX_TOOL_ROUNDS = 8;
/* 单轮调用数上限。轮数管不住一轮里发几十个写操作——被网页内容策反的模型
   可以一口气建 50 条笔记，虽然每条都有操作卡片可撤销，但用户得点 50 次。
   取 20 是为了不误伤正常的批量归类（十几条笔记一轮归完是合理用法）。 */
export const MAX_CALLS_PER_ROUND = 20;
// 回灌给模型的工具结果总预算。单条已由 runTool 截到 8000，这里管多轮累积
export const MAX_TOOL_RESULT_BUDGET = 8000;

export const PENDING_RESULT = "（此操作需要用户确认，正在等待用户决定，尚未执行）";
export const SKIPPED_RESULT = "（前一个操作正在等待用户确认，本次调用未执行；确认后如仍需要请重新发起）";
export const OVER_LIMIT_RESULT = `（单轮工具调用数已超过 ${MAX_CALLS_PER_ROUND} 个上限，本次调用未执行；确有必要请分批发起）`;
export const OMITTED_RESULT = "（更早的工具结果因上下文长度限制已省略）";
export const LIMIT_NOTICE = "（已达到工具调用轮次上限，未能完成全部操作）";

/* messages.toolPayload 的三种形态：
   - calls：assistant 消息发出的工具调用，重开会话时据此重建 tool_calls
   - result：tool 消息，已有结论（成功、失败、被拒绝都算），带撤销载荷
   - pending：tool 消息，等待用户确认，尚未执行
   把「待确认」也落成 role:"tool" 是刻意的——否则 assistant 的 tool_calls
   会永远找不到配对的结果，下次回灌时被供应商以 400 拒绝。 */
export type ToolPayload =
  | { kind: "calls"; calls: ToolCallPart[] }
  | {
      kind: "result";
      callId: string;
      name: string;
      args: string;
      ok: boolean;
      summary: string;
      noteIds?: string[];
      undo?: UndoPayload;
      // 已被用户撤销，撤销按钮置灰
      undone?: boolean;
    }
  | { kind: "pending"; callId: string; name: string; args: string; summary: string };

export type LoopEvent =
  // 文本增量，逐个转发给前端
  | { kind: "delta"; text: string }
  // 一轮问答结束，需落库为 assistant 消息
  | { kind: "assistant"; text: string; calls: ToolCallPart[] }
  | { kind: "tool_start"; call: ToolCallPart }
  | { kind: "tool_result"; call: ToolCallPart; outcome: ToolOutcome }
  | { kind: "pending_confirm"; call: ToolCallPart }
  // 未执行的调用：同批次里前一个待确认，或超出单轮调用数上限
  | { kind: "skipped"; call: ToolCallPart; reason: "pending_confirm" | "over_limit" }
  | { kind: "limit_reached" };

export interface ToolLoopDeps {
  stream(msgs: LlmMessage[]): AsyncIterable<StreamChunk>;
  execute(call: ToolCallPart): Promise<ToolOutcome>;
  requiresConfirm(name: string): boolean;
}

export function toToolCallRequest(call: ToolCallPart): ToolCallRequest {
  return { id: call.id, type: "function", function: { name: call.name, arguments: call.args } };
}

/* 工具结果的上下文预算。从最新往回累加，超出部分替换成省略提示。
   最新一条无条件保留：它可能单条就接近 8000（runTool 的截断上限），
   若一并省略，模型会拿不到刚刚执行的结果，陷入反复重试。 */
export function applyToolBudget(
  msgs: LlmMessage[],
  budget = MAX_TOOL_RESULT_BUDGET,
): LlmMessage[] {
  const out = [...msgs];
  let used = 0;
  let seen = 0;
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const m = out[i];
    if (m.role !== "tool") continue;
    seen += 1;
    if (seen === 1 || used + m.content.length <= budget) {
      used += m.content.length;
      continue;
    }
    out[i] = { ...m, content: OMITTED_RESULT };
  }
  return out;
}

export function parseToolPayload(raw: string | null): ToolPayload | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as ToolPayload;
    if (v?.kind === "calls") return Array.isArray(v.calls) ? v : null;
    if (v?.kind === "result" || v?.kind === "pending") {
      return typeof v.callId === "string" && v.callId ? v : null;
    }
    return null;
  } catch {
    // 载荷损坏时按「无工具信息的普通消息」处理，不让整个会话打不开
    return null;
  }
}

/* 历史消息转 LLM 格式。核心职责是保证 tool_calls 与 tool 结果成对——
   历史按条数截断（MAX_HISTORY）时，很容易只截到 tool 结果而丢掉发出它的
   assistant 消息，供应商会以「tool_call_id 无对应 tool_calls」400 掉整个请求。
   落单的一律丢弃：assistant 保留文本去掉调用，孤儿 tool 结果整条不发。 */
export function buildLlmMessages(rows: ChatMessageRow[]): LlmMessage[] {
  // 哪些调用真的有结果落库
  const resolved = new Set<string>();
  for (const r of rows) {
    if (r.role !== "tool") continue;
    const p = parseToolPayload(r.toolPayload);
    if (p && p.kind !== "calls") resolved.add(p.callId);
  }

  // 一条 assistant 的调用必须全部有结果才整批保留，部分有结果同样丢弃：
  // 缺任何一个配对，供应商都会拒绝整个请求
  const valid = new Set<string>();
  for (const r of rows) {
    if (r.role !== "assistant") continue;
    const p = parseToolPayload(r.toolPayload);
    if (p?.kind !== "calls" || p.calls.length === 0) continue;
    if (p.calls.every((c) => resolved.has(c.id))) {
      for (const c of p.calls) valid.add(c.id);
    }
  }

  const out: LlmMessage[] = [];
  for (const r of rows) {
    if (r.role === "user") {
      out.push({ role: "user", content: r.content });
      continue;
    }
    if (r.role === "assistant") {
      const p = parseToolPayload(r.toolPayload);
      const calls = p?.kind === "calls" ? p.calls.filter((c) => valid.has(c.id)) : [];
      if (calls.length > 0) {
        out.push({
          role: "assistant",
          content: r.content || null,
          tool_calls: calls.map(toToolCallRequest),
        });
      } else if (r.content) {
        out.push({ role: "assistant", content: r.content });
      }
      continue;
    }
    if (r.role === "tool") {
      const p = parseToolPayload(r.toolPayload);
      if (p && p.kind !== "calls" && valid.has(p.callId)) {
        out.push({ role: "tool", tool_call_id: p.callId, content: r.content });
      }
    }
  }
  return out;
}

// 部分供应商不给 tool_call id，但回灌时 tool_call_id 必填且要能对上
function withId(call: ToolCallPart, round: number, index: number): ToolCallPart {
  return call.id ? call : { ...call, id: `call_r${round}_${index}` };
}

export async function* runToolLoop(
  initial: LlmMessage[],
  deps: ToolLoopDeps,
): AsyncGenerator<LoopEvent> {
  const msgs: LlmMessage[] = [...initial];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let text = "";
    const calls: ToolCallPart[] = [];
    for await (const chunk of deps.stream(applyToolBudget(msgs))) {
      if (chunk.type === "text") {
        text += chunk.text;
        yield { kind: "delta", text: chunk.text };
      } else {
        calls.push(withId(chunk.call, round, calls.length));
      }
    }
    yield { kind: "assistant", text, calls };

    // 没有工具调用即终点。静默忽略 tools 参数的供应商也走这条路径，
    // 表现为一次普通问答，不会卡住
    if (calls.length === 0) return;

    msgs.push({ role: "assistant", content: text || null, tool_calls: calls.map(toToolCallRequest) });

    let paused = false;
    for (const [index, call] of calls.entries()) {
      if (paused) {
        yield { kind: "skipped", call, reason: "pending_confirm" };
        msgs.push({ role: "tool", tool_call_id: call.id, content: SKIPPED_RESULT });
        continue;
      }
      if (index >= MAX_CALLS_PER_ROUND) {
        yield { kind: "skipped", call, reason: "over_limit" };
        msgs.push({ role: "tool", tool_call_id: call.id, content: OVER_LIMIT_RESULT });
        continue;
      }
      if (deps.requiresConfirm(call.name)) {
        paused = true;
        yield { kind: "pending_confirm", call };
        msgs.push({ role: "tool", tool_call_id: call.id, content: PENDING_RESULT });
        continue;
      }
      yield { kind: "tool_start", call };
      const outcome = await deps.execute(call);
      yield { kind: "tool_result", call, outcome };
      msgs.push({ role: "tool", tool_call_id: call.id, content: outcome.content });
    }

    // 有待确认的调用：结束本轮流，不挂长连接等用户点击。
    // 用户决定后由 /api/chat/confirm 重建历史续跑
    if (paused) return;
  }

  yield { kind: "limit_reached" };
}
