// 助手对话的 SSE 事件协议。服务端产出、前端消费，双方共用同一份定义避免字段漂移。
//
// 事件沿用既有的「字段存在即判别」形式（{delta} / {done} / {error}），
// 不改成 {type:"..."}：老前端遇到不认识的字段会自然跳过，不会解析出错。

import type { UndoPayload } from "@/lib/ai/tools";

// 一次工具调用的标识。args 保持原始 JSON 字符串，前端渲染卡片时自行解析——
// 模型可能给出畸形 JSON，在服务端解析失败会丢掉整个事件
export interface ToolCallInfo {
  id: string;
  name: string;
  args: string;
}

export interface ToolEndInfo {
  id: string;
  name: string;
  ok: boolean;
  // 成功时是一句话摘要，失败时是错误原因（已截断）。前端据 ok 区分卡片形态
  summary: string;
  // 引用溯源涉及的笔记 id，前端据此校验模型标注的引用是否真实存在
  noteIds?: string[];
  // 落库的 tool 消息 id。撤销时回传给 /api/chat/undo
  messageId: string;
  // 是否具备撤销载荷（写工具且执行成功）
  canUndo: boolean;
}

export interface ConfirmInfo extends ToolCallInfo {
  // 待确认的 tool 消息 id，回传给 /api/chat/confirm
  messageId: string;
  conversationId: string;
  summary: string;
}

/* 来源问答的接地信息，开流前先发一条。
   noteIds 是本轮真正生效的来源笔记（主题已展开），前端拿它做引用白名单——
   全文注入模式下模型引用的笔记没经过任何工具，不给白名单就会被降级成纯文本。 */
export interface GroundingInfo {
  noteIds: string[];
  // full = 来源全文已注入；digest = 超预算只给了清单；empty = 没有可用来源
  mode: "full" | "digest" | "empty";
}

export type ChatSseEvent =
  | { delta: string }
  | { grounding: GroundingInfo }
  | { tool_start: ToolCallInfo }
  | { tool_end: ToolEndInfo }
  | { confirm_required: ConfirmInfo }
  | { done: true; conversationId: string }
  | { error: string };

// 撤销结果（/api/chat/undo 的响应）
export interface UndoResult {
  ok: boolean;
  // 失败原因：笔记已被改动（乐观锁不匹配）、已撤销过、载荷缺失
  reason?: string;
}

export type { UndoPayload };
