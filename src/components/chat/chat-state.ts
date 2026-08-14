// 助手对话的视图模型：把 SSE 事件与历史消息统一成一串可渲染的条目。
// 不含 JSX、不依赖 React——卡片的六种状态（执行中 / 成功 / 失败 / 待确认 /
// 已撤销 / 撤销被拒）全在这里判定，组件只负责画，判定逻辑可以直接断言。
//
// 从 chat-loop 复用 parseToolPayload 是刻意的：载荷格式必须与服务端写入时
// 严格一致，抄一份迟早漂移。chat-loop 对数据库与网络的引用都是 import type，
// 编译后擦除，打进客户端包的只有几个纯函数。

import type { ConfirmInfo, ToolCallInfo, ToolEndInfo, UndoResult } from "@/lib/ai/chat-events";
import type { ChatSseEvent } from "@/lib/ai/chat-events";
import { parseToolPayload } from "@/lib/ai/chat-loop";

// 工具名到中文说明。模型可能调用未知工具名（供应商幻觉），回落为原名
const TOOL_LABELS: Record<string, string> = {
  search_notes: "检索笔记",
  read_note: "读取笔记",
  list_topics: "查看主题",
  create_note: "新建笔记",
  append_to_note: "追加内容",
  update_meta: "修改分类",
  delete_note: "删除笔记",
  fetch_url: "抓取网页",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

/* 撤销按钮的四态。rejected 与 undone 一样置灰——再点一次还是会被服务端拒，
   但要保留 reason 告诉用户为什么。 */
export type UndoState = "none" | "available" | "undone" | "rejected";

export interface TextItem {
  kind: "text";
  role: "user" | "assistant";
  content: string;
}

export interface ToolItem {
  kind: "tool";
  callId: string;
  name: string;
  // 模型给的原始参数 JSON，卡片展开时按需解析（可能是畸形 JSON）
  args: string;
  status: "running" | "ok" | "failed" | "pending";
  summary: string;
  // 落库的 tool 消息 id。running 时尚未落库，故可缺省
  messageId?: string;
  // 待确认卡片回传给 /api/chat/confirm 时需要
  conversationId?: string;
  undo: UndoState;
  undoReason?: string;
  // 引用溯源白名单的来源
  noteIds?: string[];
}

export type ChatItem = TextItem | ToolItem;

// /api/chat/conversations/[id] 返回的消息行（只取渲染需要的字段）
export interface HistoryMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolPayload: string | null;
}

function runningCard(info: ToolCallInfo): ToolItem {
  return {
    kind: "tool",
    callId: info.id,
    name: info.name,
    args: info.args,
    status: "running",
    summary: "",
    undo: "none",
  };
}

function pendingCard(info: ConfirmInfo): ToolItem {
  return {
    kind: "tool",
    callId: info.id,
    name: info.name,
    args: info.args,
    status: "pending",
    summary: info.summary,
    messageId: info.messageId,
    conversationId: info.conversationId,
    undo: "none",
  };
}

/* 文本增量并到末尾的 assistant 条目上。末尾是卡片时另起一条——
   模型执行完后的说明若回填到卡片上方，读起来像是执行前就说了。 */
function appendDelta(items: ChatItem[], delta: string): ChatItem[] {
  if (!delta) return items;
  const last = items[items.length - 1];
  if (last?.kind === "text" && last.role === "assistant") {
    const next = [...items];
    next[next.length - 1] = { ...last, content: last.content + delta };
    return next;
  }
  return [...items, { kind: "text", role: "assistant", content: delta }];
}

/* 结果事件就地替换执行中/待确认的卡片。
   找不到对应卡片时补建一张：/api/chat/confirm 会先补发一条 tool_end 再开流，
   用户若刚刚刷新过页面，内存里没有那张卡片，事件不能被丢掉。 */
function upsertResult(items: ChatItem[], info: ToolEndInfo): ChatItem[] {
  const idx = items.findIndex(
    (i) => i.kind === "tool" && i.callId === info.id && (i.status === "running" || i.status === "pending"),
  );
  const prev = idx >= 0 ? (items[idx] as ToolItem) : null;
  const card: ToolItem = {
    kind: "tool",
    callId: info.id,
    name: info.name,
    args: prev?.args ?? "",
    status: info.ok ? "ok" : "failed",
    summary: info.summary,
    messageId: info.messageId,
    noteIds: info.noteIds,
    undo: info.canUndo ? "available" : "none",
  };
  if (idx < 0) return [...items, card];
  const next = [...items];
  next[idx] = card;
  return next;
}

export function applyEvent(items: ChatItem[], ev: ChatSseEvent): ChatItem[] {
  if ("delta" in ev) return appendDelta(items, ev.delta);
  if ("tool_start" in ev) return [...items, runningCard(ev.tool_start)];
  if ("tool_end" in ev) return upsertResult(items, ev.tool_end);
  if ("confirm_required" in ev) return [...items, pendingCard(ev.confirm_required)];
  // done / error 由调用方处理，不改动条目
  return items;
}

export function markUndo(items: ChatItem[], messageId: string, result: UndoResult): ChatItem[] {
  const idx = items.findIndex((i) => i.kind === "tool" && i.messageId === messageId);
  if (idx < 0) return items;
  const card = items[idx] as ToolItem;
  const next = [...items];
  next[idx] = result.ok
    ? { ...card, undo: "undone", undoReason: undefined }
    : { ...card, undo: "rejected", undoReason: result.reason };
  return next;
}

/* 从落库的消息重建条目。工具卡片一律由 role:"tool" 的行重建：
   assistant 行的 calls 载荷只是发出的请求，没有结论，画不出卡片。 */
export function rebuildItems(rows: HistoryMessage[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const r of rows) {
    if (r.role === "user" || r.role === "assistant") {
      // 只发起调用的 assistant 消息 content 是空串，渲染出来是个空气泡
      if (r.content) out.push({ kind: "text", role: r.role, content: r.content });
      continue;
    }
    if (r.role !== "tool") continue;
    const p = parseToolPayload(r.toolPayload);
    // 载荷损坏时整条跳过：画半张不知所云的卡片不如不画
    if (!p || p.kind === "calls") continue;
    if (p.kind === "pending") {
      out.push({
        kind: "tool",
        callId: p.callId,
        name: p.name,
        args: p.args,
        status: "pending",
        summary: p.summary,
        messageId: r.id,
        conversationId: r.conversationId,
        undo: "none",
      });
      continue;
    }
    out.push({
      kind: "tool",
      callId: p.callId,
      name: p.name,
      args: p.args,
      status: p.ok ? "ok" : "failed",
      summary: p.summary,
      messageId: r.id,
      noteIds: p.noteIds,
      undo: p.undone ? "undone" : p.undo ? "available" : "none",
    });
  }
  return out;
}

/* 引用溯源的白名单：模型只允许引用工具真的返回过的笔记。
   attachedNoteId 是当前页面作为上下文附件直接注入的那条，没经过工具，
   但引用它完全正当，不放行会把唯一一条真引用降级成纯文本。 */
export function collectNoteIds(items: ChatItem[], attachedNoteId?: string): Set<string> {
  const ids = new Set<string>();
  for (const i of items) {
    if (i.kind !== "tool" || !i.noteIds) continue;
    for (const id of i.noteIds) ids.add(id);
  }
  if (attachedNoteId) ids.add(attachedNoteId);
  return ids;
}

export interface CitationSegment {
  text: string;
  // 有值表示这一段是可跳转的引用标记
  noteId?: string;
}
// 笔记 id 是 cuid2（小写字母数字），放宽到 \w- 以兼容手工造的 id
const CITATION_RE = /\[\^([A-Za-z0-9_-]+)\]/g;

/* 把正文按引用标记切段。白名单外的标记连同前后文并成普通文本——
   模型会编造 id，渲染成链接点进去是 404，不如保持原样：
   用户看到的是一处无意义标记，而不是一条断掉的线索。 */
export function splitCitations(text: string, valid: ReadonlySet<string>): CitationSegment[] {
  if (!text) return [];
  const segs: CitationSegment[] = [];
  let buf = "";
  let last = 0;
  const flush = () => {
    if (buf) segs.push({ text: buf });
    buf = "";
  };
  for (const m of text.matchAll(CITATION_RE)) {
    const at = m.index ?? 0;
    buf += text.slice(last, at);
    last = at + m[0].length;
    if (valid.has(m[1])) {
      flush();
      segs.push({ text: m[0], noteId: m[1] });
    } else {
      buf += m[0];
    }
  }
  buf += text.slice(last);
  flush();
  return segs;
}

/* 逐帧读出 SSE 事件。/api/chat 与 /api/chat/confirm 的响应结构相同，共用一份。
   事件可能被网络切在任意位置，buffer 里留着最后一段不完整的帧等下一块数据——
   少了它，长回答会随机丢字。 */
export async function pumpSseEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (ev: ChatSseEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      // 心跳与注释行（以 : 开头）直接跳过
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as ChatSseEvent);
      } catch {
        // 畸形帧跳过，不中断整条流
      }
    }
  }
}
