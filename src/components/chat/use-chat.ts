"use client";

// 助手对话的状态容器：SSE 消费、会话切换、确认与撤销动作。
// 条目形态的判定全在 chat-state.ts，这里只管副作用与生命周期。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyEvent,
  markUndo,
  pumpSseEvents,
  rebuildItems,
  type ChatItem,
  type HistoryMessage,
  type ToolItem,
} from "./chat-state";

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  scopeType: string;
  // 会话创建时所围绕的笔记标题 / 主题名；全局会话没有
  scopeLabel?: string;
}

export type ChatScopeType = "note" | "topic" | "global";

export function useChat(scopeType: ChatScopeType, scopeId: string) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  // 正在撤销的操作卡片 messageId，防止连点发出两次反向操作
  const [undoing, setUndoing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/conversations");
      if (res.ok) {
        const data = (await res.json()) as { conversations?: ConversationSummary[] };
        setConversationList(data.conversations ?? []);
      }
    } catch {
      // 列表加载失败不阻塞对话
    }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const res = await fetch(`/api/chat/conversations/${id}`);
    if (!res.ok) throw new Error("加载会话失败");
    const data = (await res.json()) as { messages?: HistoryMessage[] };
    setItems(rebuildItems(data.messages ?? []));
  }, []);

  const openConversation = useCallback(
    async (id: string | null) => {
      abortRef.current?.abort();
      setConversationId(id);
      setError("");
      if (!id) {
        setItems([]);
        return;
      }
      try {
        await loadMessages(id);
      } catch {
        setError("加载会话失败");
      }
    },
    [loadMessages],
  );

  const removeConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" }).catch(() => {});
      if (id === conversationId) {
        setConversationId(null);
        setItems([]);
      }
      void loadConversations();
    },
    [conversationId, loadConversations],
  );

  /* 一轮 SSE：/api/chat 与 /api/chat/confirm 的响应结构相同，共用这段。
     确认与拒绝都会续跑一轮（模型要对结果作出回应），所以拒绝同样得把流读完。 */
  const runStream = useCallback(async (url: string, body: unknown) => {
    setError("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        // 带上状态码：调用方要靠 409 区分「这条确认已被处理过」
        const err = new Error(data.error || `请求失败 HTTP ${res.status}`) as Error & {
          status?: number;
        };
        err.status = res.status;
        throw err;
      }
      await pumpSseEvents(res.body, (ev) => {
        setItems((prev) => applyEvent(prev, ev));
        if ("error" in ev) setError(ev.error);
        if ("done" in ev) setConversationId(ev.conversationId);
      });
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "网络错误");
      }
      throw e;
    } finally {
      setStreaming(false);
      abortRef.current = null;
      void loadConversations();
    }
  }, [loadConversations]);

  const send = useCallback(
    async (text: string, useVision: boolean) => {
      const message = text.trim();
      if (!message || streaming) return;
      setItems((prev) => [...prev, { kind: "text", role: "user", content: message }]);
      await runStream("/api/chat", {
        conversationId: conversationId ?? undefined,
        scopeType,
        // 全局助手没有作用域对象，服务端要求此时不传 scopeId
        scopeId: scopeType === "global" ? undefined : scopeId,
        message,
        useVision,
      }).catch(() => {});
    },
    [conversationId, scopeType, scopeId, streaming, runStream],
  );

  /* 确认卡片的两个按钮打同一个端点，只差 approve。
     重复确认服务端返回 409——此时本地状态已过期，重新拉一次会话对齐。 */
  const respondConfirm = useCallback(
    async (item: ToolItem, approve: boolean) => {
      if (streaming || !item.messageId || !item.conversationId) return;
      const convId = item.conversationId;
      try {
        await runStream("/api/chat/confirm", {
          conversationId: convId,
          messageId: item.messageId,
          approve,
        });
      } catch (e) {
        // 409 表示这条确认已被处理过，本地状态过期了，拉一次会话对齐
        if ((e as { status?: number }).status === 409) {
          await loadMessages(convId).catch(() => {});
        }
      }
    },
    [streaming, runStream, loadMessages],
  );

  /* 撤销。服务端用 409 区分「笔记已被改动」与成功，两者都要让按钮置灰：
     前者再点还是会被拒，reason 是给用户看的原文。 */
  const undo = useCallback(
    async (messageId: string) => {
      if (undoing) return;
      setUndoing(messageId);
      try {
        const res = await fetch("/api/chat/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          reason?: string;
          error?: string;
        };
        const ok = res.ok && data.ok !== false;
        setItems((prev) => markUndo(prev, messageId, { ok, reason: data.reason ?? data.error }));
      } catch {
        setItems((prev) => markUndo(prev, messageId, { ok: false, reason: "网络错误，撤销未完成" }));
      } finally {
        setUndoing(null);
      }
    },
    [undoing],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    conversationId,
    conversationList,
    items,
    streaming,
    undoing,
    error,
    send,
    stop,
    undo,
    respondConfirm,
    loadConversations,
    openConversation,
    removeConversation,
  };
}
