"use client";

import CodeBlock from "@tiptap/extension-code-block";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";

/* 语言标为 mermaid 的代码块：光标离开时渲染成图，点图或把光标移进去变回源码。
   mermaid 有几百 KB，动态 import 保证它不进首屏 bundle——不画图的用户一字节不付。

   一条硬约束：源码永远留在 DOM 里（只是 hidden 收起），任何渲染失败都只影响
   显示。ProseMirror 的 contentDOM 一旦卸载，这个块的正文就没了处所，
   笔记内容会随渲染异常一起消失。 */

/* mermaid.render 拿这个当 DOM id 兼 CSS 选择器，必须唯一且不含冒号（React useId 带冒号，不能用）。
   每次渲染都取新号、绝不复用：mermaid 开画前会把页面上的同 id 元素删掉，
   而同一段源码重复渲染得到的 svg 字符串完全一致，React 认为 state 没变就不会重填 innerHTML——
   图被 mermaid 删了又没人补回来，块里只剩一条空槽（点进源码再点出来即可复现）。 */
let seq = 0;

/* 展示形态判定抽成纯函数：这三条分支决定用户会不会丢内容，
   必须能在不启动编辑器的情况下被测到（见 tests/lib/mermaid.test.ts） */
export function mermaidBlockMode(state: {
  language: string | null;
  editing: boolean;
  svg: string;
}): "plain" | "source" | "diagram" {
  if (state.language !== "mermaid") return "plain";
  // 编辑中、以及没有可用图形（空块或渲染失败）时一律回落源码
  if (state.editing || !state.svg) return "source";
  return "diagram";
}

function MermaidView({ node, editor, getPos }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? null;
  const isMermaid = language === "mermaid";
  const code = node.textContent;
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  // 节点被删除后 getPos 会抛，取位置一律走这里
  const posOf = useCallback(() => {
    try {
      const pos = getPos();
      return typeof pos === "number" ? pos : null;
    } catch {
      return null;
    }
  }, [getPos]);

  // 光标落在本块内 = 编辑源码；移开或编辑器失焦 = 渲染图
  useEffect(() => {
    if (!isMermaid) return;
    const sync = () => {
      const pos = posOf();
      if (pos === null) return;
      const { from, to } = editor.state.selection;
      setEditing(editor.isFocused && from >= pos && to <= pos + node.nodeSize);
    };
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("focus", sync);
    editor.on("blur", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("focus", sync);
      editor.off("blur", sync);
    };
  }, [editor, posOf, node, isMermaid]);

  // 编辑中不渲染：每敲一个字画一次图既卡又会把半截语法报成错误
  useEffect(() => {
    if (!isMermaid || editing) return;
    const source = code.trim();
    if (!source) {
      setSvg("");
      setError("");
      return;
    }
    let cancelled = false;
    const id = `kb-mermaid-${(seq += 1)}`;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          // strict：不解析图中标签里的 HTML，也不执行任何脚本
          securityLevel: "strict",
          // neutral 而非 mermaid 默认的紫色调：DESIGN.md 只留一个 accent，
          // 图是笔记内容，不该自带第二套品牌色
          theme: resolvedTheme === "dark" ? "dark" : "neutral",
        });
        const rendered = await mermaid.render(id, source);
        if (!cancelled) {
          setSvg(rendered.svg);
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setSvg("");
          setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
        }
        // mermaid 解析失败会把临时容器留在 body 里，自己收拾
        document.getElementById(`d${id}`)?.remove();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, editing, isMermaid, resolvedTheme]);

  // 点图 = 把光标送进代码块（+1 越过块的起始位置），随后 sync 会切成源码态
  const focusSource = () => {
    const pos = posOf();
    if (pos !== null) editor.chain().focus(pos + 1).run();
  };

  const mode = mermaidBlockMode({ language, editing, svg });

  if (mode === "plain") {
    return (
      <NodeViewWrapper as="pre">
        <NodeViewContent as="code" className={language ? `language-${language}` : undefined} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="relative my-3">
      {/* 出图时不能用 display:none 收起源码：ProseMirror 没法把选区映射到不渲染的元素，
          点图进来后方向键失灵、打字全落在块首。改成透明覆盖层——DOM 留在布局里，
          选区映射照常，只是看不见也点不到。contentDOM 同样绝不能卸载。 */}
      <pre
        className={
          mode === "diagram"
            ? "pointer-events-none absolute inset-0 overflow-hidden opacity-0"
            : ""
        }
      >
        <NodeViewContent as="code" className="language-mermaid" />
      </pre>
      {mode === "source" && error && (
        <p className="mt-1 text-[12px] text-danger">图表语法有误：{error}</p>
      )}
      {mode === "diagram" && (
        <div
          onClick={focusSource}
          title="点击编辑图表源码"
          className="cursor-pointer overflow-x-auto rounded-[8px] bg-fill p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </NodeViewWrapper>
  );
}

/* 只加 NodeView，不动 schema 与 Markdown 序列化：导出的仍是原生 ```mermaid
   代码块，Obsidian 等工具直接可读（导出路径零改动） */
export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});
