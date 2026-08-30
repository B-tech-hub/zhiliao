"use client";

import CodeBlock from "@tiptap/extension-code-block";
import type { NodeViewRendererProps } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";

/* Mermaid 只负责代码块的显示层，正文始终保留在 contentDOM 中。
   这里使用原生 ProseMirror NodeView，不经过 ReactNodeViewRenderer：后者在创建节点时会
   强制调用 flushSync，React 19 在提交生命周期内创建代码块时会产生开发模式警告。 */

let seq = 0;

export function mermaidBlockMode(state: {
  language: string | null;
  editing: boolean;
  svg: string;
}): "plain" | "source" | "diagram" {
  if (state.language !== "mermaid") return "plain";
  if (state.editing || !state.svg) return "source";
  return "diagram";
}

type MermaidMutation = { type: MutationRecord["type"] | "selection"; target: Node };

export function shouldIgnoreMermaidMutation(mutation: MermaidMutation, contentDOM: Node): boolean {
  if (mutation.type === "selection") return false;
  if (mutation.type === "attributes" && mutation.target === contentDOM) return true;
  return !contentDOM.contains(mutation.target);
}

function createMermaidNodeView({ node, editor, getPos }: NodeViewRendererProps): NodeView {
  let currentNode = node;
  let editing = false;
  let svg = "";
  let error = "";
  let destroyed = false;
  let renderVersion = 0;
  let renderedKey = "";

  const dom = document.createElement("div");
  const source = document.createElement("pre");
  const contentDOM = document.createElement("code");
  const errorElement = document.createElement("p");
  const diagram = document.createElement("div");

  source.append(contentDOM);
  errorElement.className = "mt-1 text-[12px] text-danger";
  diagram.title = "点击编辑图表源码";
  diagram.className =
    "cursor-pointer overflow-x-auto rounded-[8px] bg-fill p-3 " +
    "[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full";

  const language = () => (currentNode.attrs.language as string | null) ?? null;
  const isMermaid = () => language() === "mermaid";
  const theme = () => (document.documentElement.classList.contains("dark") ? "dark" : "neutral");

  const posOf = () => {
    try {
      const pos = getPos();
      return typeof pos === "number" ? pos : null;
    } catch {
      return null;
    }
  };

  const applyMode = () => {
    const mode = mermaidBlockMode({ language: language(), editing, svg });
    contentDOM.className = language() ? `language-${language()}` : "";

    if (mode === "plain") {
      dom.className = "";
      source.className = "";
      errorElement.remove();
      diagram.remove();
      if (!source.isConnected) dom.replaceChildren(source);
      return;
    }

    dom.className = "relative my-3";
    source.className =
      mode === "diagram" ? "pointer-events-none absolute inset-0 overflow-hidden opacity-0" : "";
    if (!source.isConnected) dom.prepend(source);

    if (mode === "source" && error) {
      errorElement.textContent = `图表语法有误：${error}`;
      source.after(errorElement);
    } else {
      errorElement.remove();
    }

    if (mode === "diagram") {
      diagram.innerHTML = svg;
      dom.append(diagram);
    } else {
      diagram.remove();
    }
  };

  const renderDiagram = (force = false) => {
    if (!isMermaid() || editing || destroyed) return;
    const sourceText = currentNode.textContent.trim();
    const renderTheme = theme();
    const key = `${renderTheme}\n${sourceText}`;

    if (!sourceText) {
      renderVersion += 1;
      renderedKey = key;
      svg = "";
      error = "";
      applyMode();
      return;
    }
    if (!force && renderedKey === key) return;

    renderedKey = key;
    const version = (renderVersion += 1);
    const id = `kb-mermaid-${(seq += 1)}`;

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: renderTheme,
        });
        const rendered = await mermaid.render(id, sourceText);
        if (destroyed || version !== renderVersion) return;
        svg = rendered.svg;
        error = "";
        applyMode();
      } catch (cause) {
        document.getElementById(`d${id}`)?.remove();
        if (destroyed || version !== renderVersion) return;
        svg = "";
        error = cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
        applyMode();
      }
    })();
  };

  const syncEditing = () => {
    if (!isMermaid()) {
      editing = false;
      applyMode();
      return;
    }
    const pos = posOf();
    if (pos === null) return;
    const { from, to } = editor.state.selection;
    const next = editor.isFocused && from >= pos && to <= pos + currentNode.nodeSize;
    if (next === editing) return;
    editing = next;
    applyMode();
    if (!editing) renderDiagram();
  };

  const focusSource = () => {
    const pos = posOf();
    if (pos !== null) editor.chain().focus(pos + 1).run();
  };

  const themeObserver = new MutationObserver(() => {
    if (!editing) renderDiagram(true);
  });

  diagram.addEventListener("click", focusSource);
  editor.on("selectionUpdate", syncEditing);
  editor.on("focus", syncEditing);
  editor.on("blur", syncEditing);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  applyMode();
  syncEditing();
  renderDiagram();

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type !== currentNode.type) return false;
      const previousLanguage = language();
      const previousCode = currentNode.textContent;
      currentNode = updatedNode;
      if (language() !== previousLanguage || currentNode.textContent !== previousCode) {
        renderVersion += 1;
        renderedKey = "";
        svg = "";
        error = "";
      }
      syncEditing();
      applyMode();
      if (!editing) renderDiagram();
      return true;
    },
    stopEvent(event) {
      return diagram.contains(event.target as globalThis.Node);
    },
    ignoreMutation(mutation) {
      return shouldIgnoreMermaidMutation(mutation, contentDOM);
    },
    destroy() {
      destroyed = true;
      renderVersion += 1;
      diagram.removeEventListener("click", focusSource);
      editor.off("selectionUpdate", syncEditing);
      editor.off("focus", syncEditing);
      editor.off("blur", syncEditing);
      themeObserver.disconnect();
    },
  };
}

/* 只替换代码块的视图，不改 schema 与 Markdown 序列化；导出仍是原生代码围栏。 */
export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return createMermaidNodeView;
  },
});
