"use client";

// 助手回答的只读 Markdown 渲染器。排版全部来自共享的 .prose-note，
// 与笔记编辑器同一套（见 globals.css 与 docs/adr/0016）。
//
// 安全边界：不启用 rehype-raw。模型输出的原始 HTML 一律当纯文本，
// 杜绝 `<img onerror=...>` 这类注入——助手正文是不可信内容，
// 而笔记里的内嵌 <img>（ADR-0002）走 TipTap，与这条路径无关。

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import katex from "katex";

function renderMath(value: string): React.ReactNode {
  const parts = value.split(/(\$\$[\s\S]*?\$\$|(?<!\\)\$[^$\n]+(?<!\\)\$)/g);
  return parts.map((part, index) => {
    if (part.startsWith("$$") && part.endsWith("$$")) {
      try { return <span key={index} className="math-block" dangerouslySetInnerHTML={{ __html: katex.renderToString(part.slice(2, -2), { displayMode: true, throwOnError: false }) }} />; }
      catch { return <code key={index} className="math-warning">{part}</code>; }
    }
    if (part.startsWith("$") && part.endsWith("$")) {
      try { return <span key={index} dangerouslySetInnerHTML={{ __html: katex.renderToString(part.slice(1, -1), { throwOnError: false }) }} />; }
      catch { return <code key={index} className="math-warning">{part}</code>; }
    }
    return part;
  });
}

/* 流式期间的节流。每个 delta 都重新 parse 整段 Markdown，长回答加上
   每秒几十个增量会明显卡顿；80ms 一拍在观感上仍是连续吐字。
   流结束（streaming 变 false）时立刻对齐到最终文本，不留残尾。 */
function useThrottled(value: string, streaming: boolean, ms = 80): string {
  const [shown, setShown] = useState(value);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!streaming) {
      setShown(latest.current);
      return;
    }
    const timer = setInterval(() => setShown(latest.current), ms);
    return () => {
      clearInterval(timer);
      setShown(latest.current);
    };
  }, [streaming, ms]);

  return streaming ? shown : value;
}

function MarkdownLink({
  href,
  children,
  onNavigate,
}: ComponentPropsWithoutRef<"a"> & { onNavigate?: () => void }) {
  // 站内链接（引用溯源产出的 /notes/xxx）走客户端路由，不整页刷新
  if (href?.startsWith("/")) {
    return (
      <Link href={href} onClick={onNavigate} className="align-super text-[0.8em]">
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function MarkdownView({
  text,
  streaming = false,
  onNavigate,
  className = "",
}: {
  text: string;
  // 正在流式接收：开启节流，并容忍半截的 Markdown 语法
  streaming?: boolean;
  // 站内跳转前的回调（助手面板据此关闭抽屉）
  onNavigate?: () => void;
  className?: string;
}) {
  const shown = useThrottled(text, streaming);
  return (
    <div className={`prose-note ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          text: ({ children }) => <>{renderMath(String(children))}</>,
          a: (props) => <MarkdownLink {...props} onNavigate={onNavigate} />,
        }}
      >
        {shown}
      </ReactMarkdown>
    </div>
  );
}
