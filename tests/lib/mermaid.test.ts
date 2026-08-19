// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { MermaidCodeBlock, mermaidBlockMode } from "@/components/mermaid-code-block";

/* 编辑器里的 mermaid 块最终要以原生 ```mermaid 代码块存回笔记正文——
   导出打包后能被 Obsidian 直接读，靠的就是这条。语言标记一旦在
   round-trip 中丢失，图会变成普通代码块，而且是静默发生的。

   用 headless Editor（不挂 React NodeView）：这里验的是 schema 与序列化契约，
   NodeView 只是渲染层，不参与 Markdown 进出。 */
function roundTrip(markdown: string, extensions: Extensions = [StarterKit, Markdown]) {
  const editor = new Editor({ extensions, content: markdown });
  const out = editor.storage.markdown.getMarkdown() as string;
  editor.destroy();
  return out;
}

describe("mermaid 代码块的 Markdown 进出", () => {
  const md = "```mermaid\ngraph TD\n  A[记笔记] --> B[AI 整理]\n```";

  it("原生代码块保留 mermaid 语言标记", () => {
    expect(roundTrip(md)).toContain("```mermaid");
    expect(roundTrip(md)).toContain("A[记笔记] --> B[AI 整理]");
  });

  // 换成带 NodeView 的扩展后，序列化结果必须与原生完全一致
  it("换用 MermaidCodeBlock 后序列化结果不变", () => {
    const custom = [StarterKit.configure({ codeBlock: false }), MermaidCodeBlock, Markdown];
    expect(roundTrip(md, custom)).toBe(roundTrip(md));
  });

  it("其他语言的代码块不受影响", () => {
    const js = "```js\nconst a = 1;\n```";
    const custom = [StarterKit.configure({ codeBlock: false }), MermaidCodeBlock, Markdown];
    expect(roundTrip(js, custom)).toContain("```js");
    expect(roundTrip(js, custom)).toBe(roundTrip(js));
  });

  it("使用原生 NodeView，避免 TipTap React renderer 调用 flushSync", () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false }), MermaidCodeBlock, Markdown],
      content: md,
    });

    expect(editor.view.dom.querySelector(".react-renderer")).toBeNull();
    expect(editor.view.dom.querySelector("pre code.language-mermaid")?.textContent).toContain("graph TD");
    editor.destroy();
  });
});

describe("展示形态判定", () => {
  it("非 mermaid 代码块走原样式", () => {
    expect(mermaidBlockMode({ language: "js", editing: false, svg: "<svg/>" })).toBe("plain");
    expect(mermaidBlockMode({ language: null, editing: false, svg: "" })).toBe("plain");
  });

  it("光标在块内时显示源码，移开后显示图", () => {
    expect(mermaidBlockMode({ language: "mermaid", editing: true, svg: "<svg/>" })).toBe("source");
    expect(mermaidBlockMode({ language: "mermaid", editing: false, svg: "<svg/>" })).toBe("diagram");
  });

  /* 渲染失败绝不能吞掉源码：图画不出来是显示问题，
     用户写下的内容必须原样留在编辑器里 */
  it("渲染不出图时一律回落源码", () => {
    expect(mermaidBlockMode({ language: "mermaid", editing: false, svg: "" })).toBe("source");
  });
});
