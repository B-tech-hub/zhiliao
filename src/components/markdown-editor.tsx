"use client";

import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type Editor, type ReactNodeViewProps } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useState } from "react";
import { MermaidCodeBlock } from "./mermaid-code-block";
import { SlashMenu, useSlashMenu } from "./slash-menu";
import katex from "katex";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import { mathMarkdownToEditorHtml } from "@/lib/math";

function MathNodeView({ node, updateAttributes }: ReactNodeViewProps) {
  const latex = String(node.attrs.latex ?? "");
  const display = Boolean(node.attrs.display);
  let html = "";
  try { html = katex.renderToString(latex, { displayMode: display, throwOnError: true }); }
  catch { html = `<code class=\"math-warning\">${latex.replaceAll("<", "&lt;")}</code>`; }
  return <NodeViewWrapper as={display ? "div" : "span"} className={display ? "math-node math-block" : "math-node"} onClick={() => { const next = window.prompt("编辑 LaTeX 公式", latex); if (next !== null) updateAttributes({ latex: next }); }} title="点击编辑 LaTeX 源码"><span dangerouslySetInnerHTML={{ __html: html }} /></NodeViewWrapper>;
}

const MathNode = Node.create({
  name: "math", inline: true, group: "inline", atom: true, selectable: true,
  addAttributes() { return { latex: { default: "x^2" }, display: { default: false } }; },
  parseHTML() { return [{ tag: "span[data-math]", getAttrs: (element) => ({ latex: (element as HTMLElement).getAttribute("data-latex") ?? "", display: (element as HTMLElement).getAttribute("data-display") === "true" }) }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes({ "data-math": "", "data-latex": HTMLAttributes.latex, "data-display": String(Boolean(HTMLAttributes.display)), class: "math-node" })]; },
  renderText({ node }) { return node.attrs.display ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$`; },
  addNodeView() { return ReactNodeViewRenderer(MathNodeView); },
  addStorage() { const markdown: MarkdownNodeSpec = { serialize(state, node) { state.write(node.attrs.display ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$`); }, parse: {} }; return { markdown }; },
  // TipTap 动态命令需要扩展其链式类型，运行时命令仍由节点提供。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommands() { return { setMath: (attrs: { latex: string; display?: boolean }) => ({ commands }: { commands: { insertContent: (content: unknown) => boolean } }) => commands.insertContent({ type: this.name, attrs }) } as any; },
});

async function uploadImage(file: File, noteId?: string): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  if (noteId) form.append("noteId", noteId);
  try {
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url as string;
  } catch {
    return null;
  }
}

function insertImages(editor: Editor, files: File[], noteId?: string) {
  for (const file of files) {
    void uploadImage(file, noteId).then((url) => {
      if (url) {
        editor.chain().focus().setImage({ src: url }).run();
      } else {
        alert("图片上传失败");
      }
    });
  }
}

// 扩展 Image：支持宽度与对齐，序列化为内嵌 HTML 存入 Markdown（决策见 docs/adr）
const RichImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute("width"),
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
      align: {
        default: null,
        parseHTML: (el) => {
          const style = el.getAttribute("style") ?? "";
          if (style.includes("margin-left: auto") && style.includes("margin-right: auto")) return "center";
          if (style.includes("margin-left: auto")) return "right";
          return null;
        },
        renderHTML: (attrs) => {
          if (attrs.align === "center") return { style: "display: block; margin-left: auto; margin-right: auto;" };
          if (attrs.align === "right") return { style: "display: block; margin-left: auto;" };
          return {};
        },
      },
    };
  },
});

type EditorIconName =
  | "align-left"
  | "align-center"
  | "align-right"
  | "list"
  | "link"
  | "image"
  | "math"
  | "table";

/* 工具栏图标统一为 24 网格线性 SVG（实际渲染 16px），避免 emoji 与字体回退造成的视觉漂移。 */
function EditorIcon({ name }: { name: EditorIconName }) {
  const paths: Record<EditorIconName, React.ReactNode> = {
    "align-left": (
      <>
        <path d="M5 6h14M5 12h10M5 18h14" />
      </>
    ),
    "align-center": (
      <>
        <path d="M5 6h14M7 12h10M5 18h14" />
      </>
    ),
    "align-right": (
      <>
        <path d="M5 6h14M9 12h10M5 18h14" />
      </>
    ),
    list: (
      <>
        <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
        <path d="M9 7h10M9 12h10M9 17h10" />
      </>
    ),
    link: (
      <>
        <path d="m9.5 14.5 5-5" />
        <path d="M7.4 17.6H6a4 4 0 0 1 0-8h3" />
        <path d="M16.6 6.4H18a4 4 0 0 1 0 8h-3" />
      </>
    ),
    image: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="m4.5 17 4.5-4 3 2.5 2-2 5.5 4.5" />
      </>
    ),
    math: (
      <>
        <path d="M5 5h8l-4 7 4 7H5" />
        <path d="m15 9 4 6m0-6-4 6" />
      </>
    ),
    table: (
      <>
        <rect x="3.5" y="4" width="17" height="16" rx="1" />
        <path d="M3.5 9.5h17M3.5 14.5h17M9 4v16M15 4v16" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}

/* 工具栏按钮：安静的小方块，激活态加底色 */
function ToolButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 min-w-7 items-center justify-center rounded-utility px-1 text-[13px] transition-colors ${
        active ? "bg-fill text-ink-80 font-semibold" : "text-ink-48 hover:bg-fill/60"
      }`}
    >
      {children}
    </button>
  );
}

/* 图片选中态工具条：宽度预设 / 对齐 / 说明文字（alt） */
function ImageToolbar({ editor, noteId }: { editor: Editor; noteId?: string }) {
  const attrs = editor.getAttributes("image");
  const setAttr = (patch: Record<string, unknown>) =>
    editor.chain().focus().updateAttributes("image", patch).run();
  return (
    <div className="flex flex-wrap items-center gap-1 border-l border-hairline pl-2">
      {[
        { label: "50%", w: "50%" },
        { label: "75%", w: "75%" },
        { label: "100%", w: "100%" },
        { label: "原始", w: null },
      ].map((o) => (
        <ToolButton
          key={o.label}
          title={`宽度 ${o.label}`}
          active={attrs.width === o.w}
          onClick={() => setAttr({ width: o.w })}
        >
          {o.label}
        </ToolButton>
      ))}
      <ToolButton title="左对齐" active={!attrs.align} onClick={() => setAttr({ align: null })}>
        <EditorIcon name="align-left" />
      </ToolButton>
      <ToolButton title="居中" active={attrs.align === "center"} onClick={() => setAttr({ align: "center" })}>
        <EditorIcon name="align-center" />
      </ToolButton>
      <ToolButton title="右对齐" active={attrs.align === "right"} onClick={() => setAttr({ align: "right" })}>
        <EditorIcon name="align-right" />
      </ToolButton>
      <ToolButton
        title="说明文字"
        onClick={() => {
          const alt = window.prompt("图片说明文字", attrs.alt ?? "");
          if (alt !== null) setAttr({ alt });
        }}
      >
        说明
      </ToolButton>
      {noteId && typeof attrs.src === "string" && attrs.src.startsWith("/api/images/") && (
        <ToolButton title="转写此图" onClick={async () => {
          const filename = attrs.src.split("/").pop();
          if (!filename) return;
          const res = await fetch(`/api/notes/${noteId}/transcribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename }) });
          if (!res.ok) alert("转写任务提交失败");
          else alert("已加入手写转写队列");
        }}>转写</ToolButton>
      )}
    </div>
  );
}

/* 表格选中态工具条：行列增删（不提供"上方加行"，避免破坏表头首行导致无法序列化为 GFM） */
function TableToolbar({ editor }: { editor: Editor }) {
  const run = (fn: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) =>
    fn(editor.chain().focus()).run();
  return (
    <div className="flex flex-wrap items-center gap-1 border-l border-hairline pl-2">
      <ToolButton title="下方加行" onClick={() => run((c) => c.addRowAfter())}>↓行</ToolButton>
      <ToolButton title="左侧加列" onClick={() => run((c) => c.addColumnBefore())}>←列</ToolButton>
      <ToolButton title="右侧加列" onClick={() => run((c) => c.addColumnAfter())}>→列</ToolButton>
      <ToolButton title="删除当前行" onClick={() => run((c) => c.deleteRow())}>删行</ToolButton>
      <ToolButton title="删除当前列" onClick={() => run((c) => c.deleteColumn())}>删列</ToolButton>
      <ToolButton title="删除表格" onClick={() => run((c) => c.deleteTable())}>删表</ToolButton>
    </div>
  );
}

/* 链接输入气泡：选中文字后设置/取消链接 */
function LinkPopover({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [url, setUrl] = useState<string>(editor.getAttributes("link").href ?? "");
  const apply = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    onClose();
  };
  return (
    <div className="absolute left-0 top-9 z-10 flex items-center gap-1.5 rounded-utility border border-hairline bg-surface p-1.5 shadow-lg">
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
          if (e.key === "Escape") onClose();
        }}
        placeholder="输入网址，留空取消链接"
        className="h-7 w-56 rounded-utility bg-fill/60 px-2 text-[13px] outline-none"
      />
      <button
        type="button"
        onClick={apply}
        className="h-7 rounded-utility bg-cta px-2.5 text-[13px] text-cta-ink active:scale-95"
      >
        确定
      </button>
    </div>
  );
}

function EditorToolbar({ editor, noteId }: { editor: Editor; noteId?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showLink, setShowLink] = useState(false);
  return (
    <div className="relative mb-3 flex flex-wrap items-center gap-0.5 border-b border-divider pb-2">
      <ToolButton title="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <b>B</b>
      </ToolButton>
      <ToolButton title="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <i>I</i>
      </ToolButton>
      <ToolButton title="标题" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        H2
      </ToolButton>
      <ToolButton title="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <EditorIcon name="list" />
      </ToolButton>
      <ToolButton title="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1.
      </ToolButton>
      <ToolButton title="代码块" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        {"</>"}
      </ToolButton>
      <ToolButton title="链接" active={editor.isActive("link")} onClick={() => setShowLink((v) => !v)}>
        <EditorIcon name="link" />
      </ToolButton>
      <ToolButton title="插入图片" onClick={() => fileRef.current?.click()}>
        <EditorIcon name="image" />
      </ToolButton>
      <ToolButton title="插入数学公式" onClick={() => {
        const formula = window.prompt("输入 LaTeX 公式", "x^2");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (formula) (editor.chain().focus() as any).setMath({ latex: formula }).run();
      }}>
        <EditorIcon name="math" />
      </ToolButton>
      <ToolButton
        title="插入表格"
        active={editor.isActive("table")}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <EditorIcon name="table" />
      </ToolButton>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) insertImages(editor, files, noteId);
          e.target.value = "";
        }}
      />
      {showLink && <LinkPopover editor={editor} onClose={() => setShowLink(false)} />}
      {editor.isActive("image") && <ImageToolbar editor={editor} noteId={noteId} />}
      {editor.isActive("table") && <TableToolbar editor={editor} />}
    </div>
  );
}

// Markdown 所见即所得编辑器：内容以 Markdown 字符串进出（图片属性以内嵌 HTML 序列化），
// 支持粘贴/拖入/按钮插入图片、自动识别链接
export function MarkdownEditor({
  value,
  onChange,
  noteId,
  placeholder,
  hideToolbar,
}: {
  value: string;
  onChange: (markdown: string) => void;
  noteId?: string;
  placeholder?: string;
  // 专注模式下藏起工具栏，只留标题与正文
  hideToolbar?: boolean;
}) {
  // 斜杠菜单的键盘处理要挂进 editorProps，但它依赖 editor 本身——
  // 用 ref 打破这个先有鸡还是先有蛋
  const slashKeyRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // 关掉 StarterKit 自带的代码块，换成带 mermaid 渲染的同名扩展
      // （schema 与输入规则 ``` 完全一致，只多了 NodeView）
      StarterKit.configure({ codeBlock: false }),
      MathNode,
      MermaidCodeBlock,
      RichImage.configure({ allowBase64: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "写点什么……" }),
      // 表格：不开 resizable（列宽存不进 GFM Markdown，决策见 docs/adr/0004）
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
    ],
    content: mathMarkdownToEditorHtml(value),
    editorProps: {
      attributes: {
        /* 正文排版全部来自共享的 .prose-note（见 globals.css）：编辑态与
           阅读态、笔记与助手回答，四处同一套，改一处四处齐动。
           这里只留 TipTap 自己的选中态样式，那是编辑器独有的。 */
        class:
          "prose-note min-h-full outline-none " +
          "[&_img.ProseMirror-selectednode]:ring-2 [&_img.ProseMirror-selectednode]:ring-action " +
          "[&_.selectedCell]:bg-action/10",
      },
      // 菜单开着时上下键、回车归它管，返回 true 阻止编辑器的默认行为
      handleKeyDown: (_view, event) => slashKeyRef.current?.(event) ?? false,
      handlePaste: (_view, event) => {        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (files.length && editor) {
          event.preventDefault();
          insertImages(editor, files, noteId);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (files.length && editor) {
          event.preventDefault();
          insertImages(editor, files, noteId);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.storage.markdown.getMarkdown());
    },
  });

  // 外部内容变化（如 AI 回写后 router.refresh）时同步进编辑器
  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown();
    if (value !== current && !editor.isFocused) {
      editor.commands.setContent(mathMarkdownToEditorHtml(value));
    }
  }, [value, editor]);

  const slash = useSlashMenu(editor);
  // 把最新的键盘处理塞回 editorProps 拿得到的那个 ref
  slashKeyRef.current = slash.handleKeyDown;

  if (!editor) {
    return <div className="min-h-0 flex-1" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!hideToolbar && <EditorToolbar editor={editor} noteId={noteId} />}
      <div
        // 目录靠这个标记找到滚动容器，据此算出当前读到哪一节
        data-note-scroll=""
        className="min-h-0 flex-1 cursor-text overflow-y-auto text-[17px] leading-[1.47]"
        onClick={() => editor.chain().focus().run()}
      >
        <EditorContent editor={editor} className="min-h-full" />
      </div>
      <SlashMenu
        menu={slash.menu}
        items={slash.items}
        index={slash.index}
        onPick={slash.apply}
        onHover={slash.setIndex}
      />
    </div>
  );
}
