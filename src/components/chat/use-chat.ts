"use client";

// AI 对话状态与 SSE 消费逻辑

import { useCallback, useEffect, useRef, useState } from "react";

export interface ChatMsg {
  // notice 是本地生成的提示行（工具执行状态等），不落库、不参与上下文
  role: "user" | "assistant" | "notice";
  content: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

// 工具名到中文说明，用于兜底提示行
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

export function useChat(scopeType: "note" | "topic", scopeId: string) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // 文本增量并到最后一条 assistant 上；若中间插过提示行则另起一条
  const appendDelta = useCallback((delta: string) => {
    setMsgs((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next[next.length - 1] = { role: "assistant", content: last.content + delta };
      } else {
        next.push({ role: "assistant", content: delta });
      }
      return next;
    });
  }, []);

  const pushNotice = useCallback((content: string) => {
    setMsgs((prev) => [...prev, { role: "notice", content }]);
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/conversations?scopeType=${scopeType}&scopeId=${scopeId}`);
      if (res.ok) {
        const data = await res.json();
        setConversationList(data.conversations ?? []);
      }
    } catch {
      // 列表加载失败不阻塞对话
    }
  }, [scopeType, scopeId]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const openConversation = useCallback(async (id: string | null) => {
    abortRef.current?.abort();
    setConversationId(id);
    setError("");
    if (!id) {
      setMsgs([]);
      return;
    }
    try {
      const res = await fetch(`/api/chat/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        // 工具消息与只带 tool_calls 的空 assistant 消息不直接展示，
        // 操作卡片的渲染在批次 D
        setMsgs(
          (data.messages ?? [])
            .filter((m: { role: string; content: string }) => m.role !== "tool" && m.content)
            .map((m: { role: string; content: string }) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
        );
      }
    } catch {
      setError("加载会话失败");
    }
  }, []);

  const removeConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" }).catch(() => {});
      if (id === conversationId) {
        setConversationId(null);
        setMsgs([]);
      }
      void loadConversations();
    },
    [conversationId, loadConversations],
  );

  const send = useCallback(
    async (text: string, useVision: boolean) => {
      const message = text.trim();
      if (!message || streaming) return;
      setError("");
      setMsgs((prev) => [...prev, { role: "user", content: message }, { role: "assistant", content: "" }]);
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conversationId ?? undefined, scopeType, scopeId, message, useVision }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `请求失败 HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const ev of events) {
            const line = ev.trim();
            if (!line.startsWith("data:")) continue;
            let payload: {
              delta?: string;
              done?: boolean;
              conversationId?: string;
              error?: string;
              tool_start?: { name: string };
              tool_end?: { name: string; ok: boolean; summary: string };
              confirm_required?: { summary: string };
            };
            try {
              payload = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (payload.delta) appendDelta(payload.delta);
            /* 批次 C 的兜底：工具事件先渲染成一行文字，操作卡片与确认按钮在批次 D。
               不处理的话，助手请求删除时这一轮 SSE 直接结束，
               用户看到的是「发了消息但毫无回应」。 */
            if (payload.tool_start) {
              pushNotice(`正在执行 ${TOOL_LABELS[payload.tool_start.name] ?? payload.tool_start.name}…`);
            }
            if (payload.tool_end) {
              const { ok, summary, name } = payload.tool_end;
              pushNotice(`${ok ? "✓" : "✗"} ${summary || TOOL_LABELS[name] || name}`);
            }
            if (payload.confirm_required) {
              pushNotice(
                `⚠ 助手请求${payload.confirm_required.summary}，需要你确认。当前版本尚不能在此确认，操作未执行。`,
              );
            }
            if (payload.error) setError(payload.error);
            if (payload.done && payload.conversationId) {
              setConversationId(payload.conversationId);
            }
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "网络错误");
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        // 清掉空的 assistant 占位。可能不在末尾——工具提示行会插到它后面
        setMsgs((prev) => prev.filter((m) => m.role !== "assistant" || m.content));
        void loadConversations();
      }
    },
    [conversationId, scopeType, scopeId, streaming, loadConversations, appendDelta, pushNotice],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    conversationId,
    conversationList,
    msgs,
    streaming,
    error,
    send,
    stop,
    openConversation,
    removeConversation,
  };
}
