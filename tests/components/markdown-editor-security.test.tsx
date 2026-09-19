// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "@/components/markdown-editor";

// 仅替换 SVG 绘图器；真实编辑器、扩展、schema、NodeView 和 Markdown 链照常运行。
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>图表</text></svg>' }),
  },
}));

const CANARY = "data-tiptap-canary";
const POISON = JSON.parse('{"__proto__":{"data-tiptap-canary":"present","onerror":""}}');
const unsafeAttributes = `__proto__='${JSON.stringify(POISON.__proto__)}' ${CANARY}="present" onerror=""`;
const html = [
  `<p ${unsafeAttributes}>安全正文 <a href="https://example.invalid/note" ${unsafeAttributes}>正常链接</a> <span data-math data-latex="x^2" data-display="false" ${unsafeAttributes}></span></p>`,
  `<img src="/api/images/test.png" alt="图片说明" width="50%" style="display: block; margin-left: auto; margin-right: auto;" ${unsafeAttributes}>`,
  `<table ${unsafeAttributes}><tbody><tr><th ${unsafeAttributes}>表头</th></tr><tr><td ${unsafeAttributes}>单元格</td></tr></tbody></table>`,
  `<pre ${unsafeAttributes}><code class="language-mermaid">graph TD\nA--&gt;B</code></pre>`,
].join("\n\n");
const network = vi.fn<typeof fetch>();

beforeEach(() => {
  network.mockReset().mockRejectedValue(new Error("测试禁止外部请求"));
  vi.stubGlobal("fetch", network);
});

afterEach(() => {
  cleanup();
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountEditor(value: string, mermaidEnabled: boolean) {
  const onChange = vi.fn<(markdown: string) => void>();
  const rendered = render(<MarkdownEditor value={value} onChange={onChange} mermaidEnabled={mermaidEnabled} />);
  const getElement = () => rendered.container.querySelector<HTMLDivElement & { editor: Editor }>(".tiptap");
  await waitFor(() => expect(getElement()?.editor).toBeTruthy());
  const element = getElement()!;
  return {
    ...rendered, element, editor: element.editor, onChange,
    sync: (next: string) => rendered.rerender(
      <MarkdownEditor value={next} onChange={onChange} mermaidEnabled={mermaidEnabled} />,
    ),
  };
}

function assertSafeAndUseful(editor: Editor) {
  const dom = document.createElement("div");
  dom.innerHTML = editor.getHTML();
  for (const root of [dom, editor.view.dom]) {
    expect(root.querySelector(`[${CANARY}], [onerror], [__proto__]`)).toBeNull();
    expect(root.textContent).toContain("安全正文");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.invalid/note");
    // ProseMirror 会为行内原子节点插入无 src 的定位图片，正文图片按 src 选择。
    expect(root.querySelector("img[src]")?.getAttribute("alt")).toBe("图片说明");
    expect(root.querySelector("td")?.textContent).toBe("单元格");
    expect(root.querySelector("pre code")?.textContent).toContain("A-->B");
  }
  const math = dom.querySelector("[data-math]");
  expect(math?.getAttribute("data-latex")).toBe("x^2");
  editor.state.doc.descendants((node) => {
    expect(Object.hasOwn(node.attrs, "__proto__")).toBe(false);
    expect(CANARY in node.attrs).toBe(false);
    for (const mark of node.marks) expect(CANARY in mark.attrs).toBe(false);
  });
  expect(Object.hasOwn(Object.prototype, CANARY)).toBe(false);
}

function transfer(text: string, htmlText = "") {
  return { files: [], getData: (type: string) => type === "text/html" ? htmlText : type === "text/plain" || type === "Text" ? text : "" };
}

describe.each([false, true])("真实编辑器安全边界：Mermaid=%s", (mermaidEnabled) => {
  it("初次加载不保留危险属性，正常内容完整", async () => {
    const { editor } = await mountEditor(html, mermaidEnabled);
    assertSafeAndUseful(editor);
  });

  it("外部正文同步通过实际 setContent 路径过滤属性", async () => {
    const mounted = await mountEditor("原正文", mermaidEnabled);
    mounted.sync(html);
    await waitFor(() => assertSafeAndUseful(mounted.editor));
    expect(mounted.editor.getText()).not.toContain("原正文");
  });

  it.each(["text", "html", "context"] as const)("%s 粘贴通过真实事件和 schema", async (kind) => {
    const { editor, element, onChange } = await mountEditor("", mermaidEnabled);
    const context = JSON.stringify(["blockquote", POISON]);
    const payload = kind === "context" ? `<div data-pm-slice='0 0 ${context}'>${html}</div>` : html;
    await act(async () => {
      fireEvent.paste(element, { clipboardData: transfer(kind === "text" ? payload : "", kind === "text" ? "" : payload) });
    });
    assertSafeAndUseful(editor);
    expect(onChange).toHaveBeenCalled();
    if (kind === "context") expect(editor.state.doc.firstChild?.type.name).toBe("blockquote");
  });

  it.each(["text", "html"] as const)("%s 拖放通过真实事件和 schema", async (kind) => {
    const { editor, element, onChange } = await mountEditor("", mermaidEnabled);
    // jsdom 没有布局坐标；仅固定落点，不替换拖放解析、事务或内容过滤。
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 1, inside: -1 });
    await act(async () => {
      fireEvent.drop(element, { clientX: 0, clientY: 0, dataTransfer: transfer(kind === "text" ? html : "", kind === "html" ? html : "") });
    });
    assertSafeAndUseful(editor);
    expect(onChange).toHaveBeenCalled();
  });

  it("图片属性、公式、表格、链接及围栏保存重开后保真", async () => {
    const first = await mountEditor(html.replace("<table", "<p>分隔段落</p>\n\n<table"), mermaidEnabled);
    const saved = first.editor.storage.markdown.getMarkdown() as string;
    first.unmount();
    const second = await mountEditor(saved, mermaidEnabled);
    assertSafeAndUseful(second.editor);
    const image = second.element.querySelector<HTMLImageElement>("img[src]");
    expect(image?.getAttribute("width")).toBe("50%");
    expect(image?.style.marginLeft).toBe("auto");
    expect(image?.style.marginRight).toBe("auto");
    expect(saved).toContain("$x^2$");
    expect(saved).toContain("| 表头 |");
    expect(saved).toContain("```mermaid");
    expect(second.editor.storage.markdown.getMarkdown()).toBe(saved);
  });

  it("图片直接相邻表格时保存重开不破坏表格", async () => {
    const first = await mountEditor(html, mermaidEnabled);
    const saved = first.editor.storage.markdown.getMarkdown() as string;
    first.unmount();
    const second = await mountEditor(saved, mermaidEnabled);
    assertSafeAndUseful(second.editor);
  });

  it("普通图片保持 Markdown，并与相邻图片和表格分隔", async () => {
    const initial = '<img src="/api/images/a.png" alt="甲"><img src="/api/images/b.png" alt="乙"><table><tr><th>表头</th></tr><tr><td>内容</td></tr></table>';
    const first = await mountEditor(initial, mermaidEnabled);
    const saved = first.editor.storage.markdown.getMarkdown() as string;
    expect(saved).toContain("![甲](/api/images/a.png)\n\n![乙](/api/images/b.png)\n\n| 表头 |");
    expect(saved).not.toContain("<img");
    first.unmount();
    const second = await mountEditor(saved, mermaidEnabled);
    expect(second.element.querySelectorAll("img[src]")).toHaveLength(2);
    expect(second.element.querySelector("td")?.textContent).toBe("内容");
    expect(second.editor.storage.markdown.getMarkdown()).toBe(saved);
  });

  it.each([
    { name: "仅对齐", attributes: 'style="display: block; margin-left: auto;"', width: null, marginLeft: "auto" },
    { name: "仅宽度", attributes: 'width="75%"', width: "75%", marginLeft: "" },
  ])("$name 的图片保留属性，说明与标题正确转义", async ({ attributes, width, marginLeft }) => {
    const initial = `<img src="/api/images/a.png" alt="说明 &quot;引用&quot; &amp; &lt;标签&gt;" title="标题 &quot;引号&quot;" ${attributes}>`;
    const first = await mountEditor(initial, mermaidEnabled);
    const saved = first.editor.storage.markdown.getMarkdown() as string;
    expect(saved).toContain("<img");
    expect(saved).toContain("&quot;");
    first.unmount();
    const second = await mountEditor(saved, mermaidEnabled);
    const image = second.element.querySelector<HTMLImageElement>("img[src]");
    expect(image?.getAttribute("width")).toBe(width);
    expect(image?.style.marginLeft).toBe(marginLeft);
    expect(image?.style.marginRight).toBe("");
    expect(image?.getAttribute("alt")).toBe('说明 "引用" & <标签>');
    expect(image?.getAttribute("title")).toBe('标题 "引号"');
    expect(second.editor.storage.markdown.getMarkdown()).toBe(saved);
  });

  it("无表头表格退回 HTML 后仍可往返", async () => {
    const initial = '<table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>';
    const first = await mountEditor(initial, mermaidEnabled);
    const saved = first.editor.storage.markdown.getMarkdown() as string;
    expect(saved).toContain("<table");
    first.unmount();
    const second = await mountEditor(saved, mermaidEnabled);
    expect([...second.element.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(["甲", "乙"]);
    expect(second.editor.storage.markdown.getMarkdown()).toBe(saved);
  });
});
