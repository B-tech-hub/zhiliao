"use client";

/* 斜杠命令菜单。不用 @tiptap/suggestion：那个包只管触发与状态机，弹层 UI
   仍要自己写，为省下的几十行引一个依赖不划算（本次改造只愿新增 Markdown
   渲染那两个）。这里直接读编辑器状态判断触发条件，逻辑一样收敛。 */

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface SlashCommand {
  label: string;
  hint: string;
  // 拉丁别名，让用户打 /h1、/table 也能命中
  aliases: string[];
  run: (editor: Editor) => void;
  // 挂在功能开关上的项：开关关闭时整条不出现在菜单里
  feature?: "mermaid";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    label: "一级标题",
    hint: "H1",
    aliases: ["h1", "biaoti", "title"],
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "二级标题",
    hint: "H2",
    aliases: ["h2", "biaoti"],
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "三级标题",
    hint: "H3",
    aliases: ["h3", "biaoti"],
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "无序列表",
    hint: "• 项目",
    aliases: ["ul", "list", "liebiao"],
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "有序列表",
    hint: "1. 项目",
    aliases: ["ol", "number", "liebiao"],
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "引用",
    hint: "块引用",
    aliases: ["quote", "yinyong"],
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "代码块",
    hint: "等宽、可高亮",
    aliases: ["code", "daima"],
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    label: "Mermaid 图",
    hint: "流程图 / 时序图，离开光标即出图",
    aliases: ["mermaid", "tu", "chart", "diagram"],
    // 代码块 + mermaid 语言，与手打 ```mermaid 完全等价
    run: (e) => e.chain().focus().toggleCodeBlock({ language: "mermaid" }).run(),
    feature: "mermaid",
  },
  {
    label: "表格",
    hint: "3×3，带表头",
    aliases: ["table", "biaoge"],
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    label: "分隔线",
    hint: "———",
    aliases: ["hr", "divider", "fenge"],
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
];

function match(cmd: SlashCommand, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return cmd.label.toLowerCase().includes(q) || cmd.aliases.some((a) => a.startsWith(q));
}

interface MenuState {
  // 斜杠本身的位置，执行命令前要把 /query 这段删掉
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
}

export function useSlashMenu(editor: Editor | null, features: { mermaid?: boolean } = {}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [index, setIndex] = useState(0);
  /* 键盘处理挂在 editorProps 上、创建时就固定了闭包，所以状态要走 ref
     才读得到最新值。items 一并放进去，避免键盘分支重算一遍过滤。 */
  const stateRef = useRef<{ menu: MenuState | null; items: SlashCommand[]; index: number }>({
    menu: null,
    items: [],
    index: 0,
  });

  // 关掉的功能连菜单项都不给：留着但点了没反应，比不出现更让人困惑
  const available = SLASH_COMMANDS.filter((c) => !c.feature || features[c.feature]);
  const items = menu ? available.filter((c) => match(c, menu.query)) : [];
  stateRef.current = { menu, items, index };

  const close = useCallback(() => {
    // 已经是关闭态就别再派发更新：每次按键都要走一遍这里
    setMenu((prev) => (prev === null ? prev : null));
    setIndex((prev) => (prev === 0 ? prev : 0));
  }, []);

  const apply = useCallback(
    (cmd: SlashCommand) => {
      const m = stateRef.current.menu;
      if (!editor || !m) return;
      // 先删掉 "/query" 再执行，否则命令会把这几个字符一起带进新块
      editor.chain().focus().deleteRange({ from: m.from, to: m.to }).run();
      cmd.run(editor);
      close();
    },
    [editor, close],
  );

  // 光标或内容一动就重算触发条件
  useEffect(() => {
    if (!editor) return;
    const compute = () => {
      if (editor.isDestroyed) return;
      const { state } = editor;
      const { $from, empty } = state.selection;
      if (!empty) return close();
      const start = $from.start();
      const textBefore = state.doc.textBetween(start, $from.pos, "\n", "\0");
      /* 触发条件：斜杠在块首或紧跟空白，后面不含空格。
         「3/4」「and/or」这类正常输入因此不会误触发。 */
      const hit = /(?:^|\s)\/([^\s/]*)$/.exec(textBefore);
      if (!hit) return close();
      const query = hit[1];
      const from = $from.pos - query.length - 1;
      // 光标坐标用来定位弹层；块首时 coordsAtPos 给的是行首
      const coords = editor.view.coordsAtPos(from);
      setMenu((prev) =>
        prev && prev.query === query && prev.from === from
          ? prev
          : { from, to: $from.pos, query, left: coords.left, top: coords.bottom },
      );
      // 只有换了查询词才回到第一项，否则上下键选好的位置会被每次输入重置
      setIndex((prev) => (stateRef.current.menu?.query === query ? prev : 0));
    };
    /* 推迟到事务之外再改 React 状态。TipTap 的 React NodeView（mermaid 代码块）
       在 ProseMirror 派发期间会走 flushSync，此时同步 setState 会撞上
       「flushSync was called from inside a lifecycle method」并可能导致渲染撕裂。 */
    const sync = () => queueMicrotask(compute);
    editor.on("selectionUpdate", sync);
    editor.on("update", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("update", sync);
    };
  }, [editor, close]);

  /* 菜单开着时接管上下键与回车。返回 true 表示事件已消费，
     ProseMirror 不再按默认行为处理（否则回车会另起一段）。 */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      const { menu: m, items: list, index: i } = stateRef.current;
      if (!m || list.length === 0) return false;
      if (event.key === "ArrowDown") {
        setIndex((v) => (v + 1) % list.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((v) => (v - 1 + list.length) % list.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        apply(list[i] ?? list[0]);
        return true;
      }
      if (event.key === "Escape") {
        close();
        return true;
      }
      return false;
    },
    [apply, close],
  );

  return { menu, items, index, setIndex, apply, close, handleKeyDown };
}

export function SlashMenu({
  menu,
  items,
  index,
  onPick,
  onHover,
}: {
  menu: { left: number; top: number } | null;
  items: SlashCommand[];
  index: number;
  onPick: (cmd: SlashCommand) => void;
  onHover: (i: number) => void;
}) {
  if (!menu || items.length === 0) return null;
  return (
    <div
      // fixed 定位：编辑器自身是滚动容器，absolute 会跟着内容滚走
      className="fixed z-40 max-h-72 w-60 overflow-y-auto rounded-card border border-hairline bg-surface py-1 shadow-lg"
      style={{ left: menu.left, top: menu.top + 6 }}
      // 别让点击夺走编辑器焦点，否则命令执行时选区已经没了
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((cmd, i) => (
        <button
          key={cmd.label}
          onClick={() => onPick(cmd)}
          onMouseEnter={() => onHover(i)}
          className={`block w-full px-3 py-1.5 text-left transition-colors ${
            i === index ? "bg-fill" : ""
          }`}
        >
          <span className="block text-[13px] text-ink-80">{cmd.label}</span>
          <span className="block text-[11px] text-ink-48">{cmd.hint}</span>
        </button>
      ))}
    </div>
  );
}
