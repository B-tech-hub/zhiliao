"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
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
      className={`flex h-7 min-w-7 items-center justify-center rounded-[6px] px-1 text-[13px] transition-colors ${
        active ? "bg-fill text-ink-80 font-semibold" : "text-ink-48 hover:bg-fill/60"
      }`}
    >
      {children}
    </button>
  );
}

/* 图片选中态工具条：宽度预设 / 对齐 / 说明文字（alt） */
function ImageToolbar({ editor }: { editor: Editor }) {
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
      <ToolButton title="左对齐" active={!attrs.align} onClick={() => setAttr({ align: null })}>⇤</ToolButton>
      <ToolButton title="居中" active={attrs.align === "center"} onClick={() => setAttr({ align: "center" })}>⇔</ToolButton>
      <ToolButton title="右对齐" active={attrs.align === "right"} onClick={() => setAttr({ align: "right" })}>⇥</ToolButton>
      <ToolButton
        title="说明文字"
        onClick={() => {
          const alt = window.prompt("图片说明文字", attrs.alt ?? "");
          if (alt !== null) setAttr({ alt });
        }}
      >
        说明
      </ToolButton>
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
    <div className="absolute left-0 top-9 z-10 flex items-center gap-1.5 rounded-[10px] border border-hairline bg-surface p-1.5 shadow-lg">
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
          if (e.key === "Escape") onClose();
        }}
        placeholder="输入网址，留空取消链接"
        className="h-7 w-56 rounded-[6px] bg-fill/60 px-2 text-[13px] outline-none"
      />
      <button
        type="button"
        onClick={apply}
        className="h-7 rounded-[6px] bg-action px-2.5 text-[13px] text-white active:scale-95"
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
        ••
      </ToolButton>
      <ToolButton title="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1.
      </ToolButton>
      <ToolButton title="代码块" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        {"</>"}
      </ToolButton>
      <ToolButton title="链接" active={editor.isActive("link")} onClick={() => setShowLink((v) => !v)}>
        🔗
      </ToolButton>
      <ToolButton title="插入图片" onClick={() => fileRef.current?.click()}>
        🖼
      </ToolButton>
      <ToolButton
        title="插入表格"
        active={editor.isActive("table")}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        ⊞
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
      {editor.isActive("image") && <ImageToolbar editor={editor} />}
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
}: {
  value: string;
  onChange: (markdown: string) => void;
  noteId?: string;
  placeholder?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
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
    content: value,
    editorProps: {
      attributes: {
        class:
          "max-w-none min-h-full outline-none [&_img]:max-w-full [&_img]:rounded-[8px] " +
          "[&_img.ProseMirror-selectednode]:ring-2 [&_img.ProseMirror-selectednode]:ring-action " +
          "[&_a]:text-action [&_a]:underline [&_a]:underline-offset-2 " +
          "[&_h1]:text-[28px] [&_h1]:font-semibold [&_h2]:text-[21px] [&_h2]:font-semibold [&_h3]:font-semibold " +
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 " +
          "[&_blockquote]:border-l-2 [&_blockquote]:border-hairline [&_blockquote]:pl-3 [&_blockquote]:text-ink-48 " +
          "[&_code]:rounded [&_code]:bg-fill [&_code]:px-1 [&_pre]:rounded-[8px] [&_pre]:bg-fill [&_pre]:p-3 " +
          "[&_table]:w-full [&_table]:border-collapse [&_table]:table-fixed " +
          "[&_th]:border [&_th]:border-hairline [&_th]:bg-fill/60 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold " +
          "[&_td]:border [&_td]:border-hairline [&_td]:px-2 [&_td]:py-1.5 " +
          "[&_.selectedCell]:bg-action/10",
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
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
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  if (!editor) {
    return <div className="min-h-0 flex-1" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EditorToolbar editor={editor} noteId={noteId} />
      <div
        className="min-h-0 flex-1 cursor-text overflow-y-auto text-[17px] leading-[1.47]"
        onClick={() => editor.chain().focus().run()}
      >
        <EditorContent editor={editor} className="min-h-full" />
      </div>
    </div>
  );
}
