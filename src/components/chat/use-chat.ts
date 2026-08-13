"use client";

// AI 对话状态与 SSE 消费逻辑

import { useCallback, useEffect, useRef, useState } from "react";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export function useChat(scopeType: "note" | "topic", scopeId: string) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

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
        setMsgs(
          (data.messages ?? []).map((m: { role: string; content: string }) => ({
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
            let payload: { delta?: string; done?: boolean; conversationId?: string; error?: string };
            try {
              payload = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (payload.delta) {
              const delta = payload.delta;
              setMsgs((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  role: "assistant",
                  content: next[next.length - 1].content + delta,
                };
                return next;
              });
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
        // 清掉空的 assistant 占位
        setMsgs((prev) =>
          prev.length && prev[prev.length - 1].role === "assistant" && !prev[prev.length - 1].content
            ? prev.slice(0, -1)
            : prev,
        );
        void loadConversations();
      }
    },
    [conversationId, scopeType, scopeId, streaming, loadConversations],
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
