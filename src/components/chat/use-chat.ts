"use client";

// 助手对话的状态容器：SSE 消费、会话切换、确认与撤销动作。
// 条目形态的判定全在 chat-state.ts，这里只管副作用与生命周期。

import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceItem, SourceRef } from "@/lib/ai/sources";
import {
  applyEvent,
  finalizeStream,
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
  // 会话创建时所围绕的笔记标题 / 主题名；全局会话没有，来源问答显示来源条数
  scopeLabel?: string;
}

export type ChatScopeType = "note" | "topic" | "global" | "sources";

export function useChat(scopeType: ChatScopeType, scopeId: string) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  // 正在撤销的操作卡片 messageId，防止连点发出两次反向操作
  const [undoing, setUndoing] = useState<string | null>(null);
  const [error, setError] = useState("");
  /* 来源问答态。grounded 为真时整条会话都严格接地，与页面上下文附件互斥——
     附件跟着页面走，来源集是用户显式挑的，两者同时生效只会让人搞不清 AI 到底看得见什么。 */
  const [grounded, setGrounded] = useState(false);
  const [sources, setSources] = useState<SourceItem[]>([]);
  // 服务端回报的本轮生效来源笔记，供引用溯源放行
  const [sourceNoteIds, setSourceNoteIds] = useState<string[]>([]);
  // 来源超预算：只有清单进了 prompt，正文靠工具取；无工具模型下要提醒用户
  const [sourcesTruncated, setSourcesTruncated] = useState(false);
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
    const data = (await res.json()) as {
      conversation?: { scopeType?: string };
      messages?: HistoryMessage[];
      sources?: SourceItem[];
      sourceNoteIds?: string[];
    };
    setItems(rebuildItems(data.messages ?? []));
    // 接地与否由会话自己说了算，不看当前页面——从历史里打开一次来源问答仍是来源问答
    const isGrounded = data.conversation?.scopeType === "sources";
    setGrounded(isGrounded);
    setSources(isGrounded ? (data.sources ?? []) : []);
    setSourceNoteIds(isGrounded ? (data.sourceNoteIds ?? []) : []);
    setSourcesTruncated(false);
  }, []);

  const openConversation = useCallback(
    async (id: string | null) => {
      abortRef.current?.abort();
      setConversationId(id);
      setError("");
      if (!id) {
        setItems([]);
        setGrounded(false);
        setSources([]);
        setSourceNoteIds([]);
        setSourcesTruncated(false);
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

  /* 开一个新的来源问答。会话行要等首条消息才建（沿用惰性创建），
     所以来源集先只存在前端，随首条消息一起提交。 */
  const startGrounded = useCallback((picked: SourceItem[]) => {
    abortRef.current?.abort();
    setConversationId(null);
    setItems([]);
    setError("");
    setGrounded(true);
    setSources(picked);
    setSourceNoteIds([]);
    setSourcesTruncated(false);
  }, []);

  /* 改来源集。会话已建则落库（下一条消息生效），未建则只改前端。
     已经产生的回答不追溯重算——用户看到的历史仍是当时那批来源的产物。 */
  const updateSources = useCallback(
    async (picked: SourceItem[]) => {
      setSources(picked);
      if (!conversationId) return;
      const refs: SourceRef[] = picked.map((s) => ({ type: s.type, id: s.id }));
      try {
        const res = await fetch(`/api/chat/conversations/${conversationId}/sources`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sources: refs }),
        });
        if (res.ok) {
          const data = (await res.json()) as { sources?: SourceItem[] };
          setSources(data.sources ?? picked);
        }
      } catch {
        setError("来源集保存失败，请重试");
      }
    },
    [conversationId],
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
      let sawDone = false;
      let sawError = false;
      await pumpSseEvents(res.body, (ev) => {
        setItems((prev) => applyEvent(prev, ev));
        if ("grounding" in ev) {
          setSourceNoteIds(ev.grounding.noteIds);
          setSourcesTruncated(ev.grounding.mode === "digest");
        }
        if ("error" in ev) {
          sawError = true;
          setError(ev.error);
        }
        if ("done" in ev) {
          sawDone = true;
          setConversationId(ev.conversationId);
        }
      });
      // 流自然结束却没见到 done：把最后那段话标成可能不完整
      setItems((prev) =>
        finalizeStream(prev, { sawDone, sawError, aborted: controller.signal.aborted }),
      );
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
    async (text: string, useVision: boolean, useReasoning = false) => {
      const message = text.trim();
      if (!message || streaming) return;
      setItems((prev) => [...prev, { kind: "text", role: "user", content: message }]);
      // 接地会话不带页面上下文附件：来源集是唯一的知识边界
      const effectiveScope: ChatScopeType = grounded ? "sources" : scopeType;
      await runStream("/api/chat", {
        conversationId: conversationId ?? undefined,
        scopeType: effectiveScope,
        // 只有 note/topic 有作用域对象，其余不传
        scopeId: effectiveScope === "note" || effectiveScope === "topic" ? scopeId : undefined,
        // 来源集随首条消息落库；续聊时服务端以会话已存的为准
        sources:
          grounded && !conversationId
            ? sources.map((s) => ({ type: s.type, id: s.id }))
            : undefined,
        message,
        useVision,
        useReasoning,
      }).catch(() => {});
    },
    [conversationId, scopeType, scopeId, streaming, runStream, grounded, sources],
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
    grounded,
    sources,
    sourceNoteIds,
    sourcesTruncated,
    send,
    stop,
    undo,
    respondConfirm,
    loadConversations,
    openConversation,
    startGrounded,
    updateSources,
    removeConversation,
  };
}
