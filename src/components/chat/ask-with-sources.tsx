"use client";

// 「以此为来源提问」的快捷入口。
// 助手面板挂在 (app)/layout 上，笔记页/主题页够不到它的状态，
// 用一个自定义事件把来源递过去——比为一个按钮铺一层 Context 轻。

import type { SourceItem } from "@/lib/ai/sources";

const EVENT = "zhiliao:ask-with-sources";

export function askWithSources(sources: SourceItem[]): void {
  window.dispatchEvent(new CustomEvent<SourceItem[]>(EVENT, { detail: sources }));
}

export function onAskWithSources(handler: (sources: SourceItem[]) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<SourceItem[]>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

// 笔记页与主题页的按钮：点了打开助手面板，并以当前对象为唯一来源开一场来源问答
export function AskWithSourcesButton({
  type,
  id,
  label,
  className = "",
}: {
  type: "note" | "topic";
  id: string;
  label: string;
  className?: string;
}) {
  return (
    <button
      onClick={() => askWithSources([{ type, id, label }])}
      className={className}
      title={`只依据这${type === "note" ? "条笔记" : "个主题"}的内容提问`}
    >
      以此为来源提问
    </button>
  );
}
