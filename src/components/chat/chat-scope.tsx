"use client";

// 当前页面提供给助手的上下文附件。
// 助手面板挂在 (app)/layout 上，而「用户此刻在看哪条笔记」只有页面自己知道，
// 由页面渲染一个 Binder 登记进来；离开页面自动摘除。

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export interface ChatScope {
  type: "note" | "topic";
  id: string;
  title: string;
  // 笔记正文含图片时才显示「让 AI 看图」开关
  hasImages?: boolean;
}

interface ChatScopeStore {
  scope: ChatScope | null;
  setScope: (s: ChatScope | null) => void;
}

const ChatScopeContext = createContext<ChatScopeStore>({ scope: null, setScope: () => {} });

export function ChatScopeProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState<ChatScope | null>(null);
  const value = useMemo(() => ({ scope, setScope }), [scope]);
  return <ChatScopeContext.Provider value={value}>{children}</ChatScopeContext.Provider>;
}

export function useChatScope(): ChatScopeStore {
  return useContext(ChatScopeContext);
}

// 无渲染组件：笔记页与主题页各放一个，把自己登记为当前上下文附件
export function ChatScopeBinder({ type, id, title, hasImages }: ChatScope) {
  const { setScope } = useChatScope();
  useEffect(() => {
    setScope({ type, id, title, hasImages });
    return () => setScope(null);
  }, [setScope, type, id, title, hasImages]);
  return null;
}
