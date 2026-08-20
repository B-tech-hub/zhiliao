"use client";

import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BodyPortal } from "@/components/body-portal";
import { COMMAND_EVENTS, dispatchCommand } from "@/components/command-events";

interface TopicItem {
  id: string;
  name: string;
}

interface SearchItem {
  id: string;
  title: string;
  excerpt: string;
  topicName: string;
}

type Result =
  | { kind: "note"; id: string; title: string; detail: string }
  | { kind: "topic"; id: string; title: string; detail: string }
  | { kind: "action"; id: string; title: string; detail: string; run: () => void };

const ACTION_IDS = {
  newNote: "new-note",
  toggleTheme: "toggle-theme",
  toggleChat: "toggle-chat",
  toggleNav: "toggle-nav",
  trash: "trash",
} as const;

export function CommandPalette({ topics }: { topics: TopicItem[] }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  /* BodyPortal 是两阶段挂载（首渲染返回 null，等自己的 effect 置 mounted 才 createPortal），
     打开时用 effect + rAF 抢焦点会扑空——那一刻 input 还没进 DOM。
     改成 callback ref：节点一挂上就聚焦，时序上不可能错过。
     这条路径断了不只是搜索不了：焦点留在正文里，敲的字会直接写进笔记。 */
  const focusInput = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    node?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // 记在这儿而不是 effect 里：此刻面板还没挂载，activeElement 一定还是调用方
        if (!open) restoreRef.current = document.activeElement as HTMLElement | null;
        setOpen((value) => !value);
        return;
      }
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    const value = query.trim();
    // 清空要立刻生效，不该再等一轮防抖
    if (!value) {
      setNotes([]);
      setLoading(false);
      return;
    }
    /* 只清定时器挡不住已经上路的请求：连打两个词时先发的那个可能后回来，
       把新词的结果盖掉。用 AbortController 让 cleanup 真正掐断旧请求。 */
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as { results?: SearchItem[] };
        setNotes(data.results ?? []);
      } catch {
        // 被中断或网络出错：保留上一次结果，不闪空态
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  /* 关面板时清状态，并把焦点还给打开面板前的那个元素。 */
  useEffect(() => {
    if (open) return;
    setQuery("");
    setNotes([]);
    const target = restoreRef.current;
    restoreRef.current = null;
    /* 面板卸载后 activeElement 会掉回 body；若此刻已经有别的元素拿着焦点，
       说明面板执行的动作又开出了新的一层（⌘K「新建笔记」唤起的快速捕获浮层
       就是这样），那一层比调用方更该拿焦点，不能抢回来——抢回来的后果是
       用户对着浮层打字，字一个也进不去。 */
    const active = document.activeElement;
    if (target && (!active || active === document.body)) target.focus();
  }, [open]);

  // 键盘选中项移出可视区时跟随滚动，否则按到列表下方就看不见选的是哪条
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const results = useMemo<Result[]>(() => {
    const value = query.trim().toLowerCase();
    const topicResults = topics
      .filter((topic) => !value || topic.name.toLowerCase().includes(value))
      .map((topic) => ({ kind: "topic" as const, id: topic.id, title: topic.name, detail: "跳转到主题" }));
    const noteResults = notes.map((note) => ({
      kind: "note" as const,
      id: note.id,
      title: note.title || "无标题笔记",
      detail: note.topicName || note.excerpt,
    }));
    const actions: Result[] = [
      { kind: "action", id: ACTION_IDS.newNote, title: "新建笔记", detail: "打开空白记录", run: () => router.push("/notes/new") },
      { kind: "action", id: ACTION_IDS.toggleTheme, title: resolvedTheme === "dark" ? "切换浅色" : "切换深色", detail: "切换界面主题", run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") },
      { kind: "action", id: ACTION_IDS.toggleChat, title: "开关助手", detail: "打开或关闭 AI 助手", run: () => dispatchCommand(COMMAND_EVENTS.toggleChat) },
      { kind: "action", id: ACTION_IDS.toggleNav, title: "折叠侧栏", detail: "切换侧栏折叠状态", run: () => dispatchCommand(COMMAND_EVENTS.toggleNav) },
      { kind: "action", id: ACTION_IDS.trash, title: "去回收站", detail: "查看已删除笔记", run: () => router.push("/trash") },
    ];
    const filteredActions = actions.filter((action) => !value || `${action.title}${action.detail}`.toLowerCase().includes(value));
    return [...noteResults, ...topicResults, ...filteredActions];
  }, [notes, query, resolvedTheme, router, setTheme, topics]);

  useEffect(() => {
    setIndex((value) => Math.min(value, Math.max(0, results.length - 1)));
  }, [results.length]);

  function execute(result: Result | undefined) {
    if (!result) return;
    setOpen(false);
    if (result.kind === "note") router.push(`/notes/${result.id}`);
    else if (result.kind === "topic") router.push(`/topics/${result.id}`);
    else result.run();
  }

  if (!open) return null;
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="命令面板"
          className="w-full max-w-xl overflow-hidden rounded-card border border-hairline bg-surface shadow-2xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <input
            ref={focusInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((value) => (value + 1) % Math.max(1, results.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((value) => (value - 1 + Math.max(1, results.length)) % Math.max(1, results.length));
              } else if (event.key === "Enter") {
                event.preventDefault();
                execute(results[index]);
              } else if (event.key === "Tab") {
                // 选择靠上下键，Tab 没有去处；锁在输入框里顺带把焦点关在面板内
                event.preventDefault();
              }
            }}
            placeholder="搜索笔记、主题或执行动作"
            className="h-12 w-full border-b border-divider bg-transparent px-4 text-[17px] outline-none placeholder:text-ink-48"
            aria-label="搜索命令"
          />
          <div ref={listRef} className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
            {loading && <p className="px-3 py-4 text-[13px] text-ink-48">搜索中…</p>}
            {!loading && results.length === 0 && <p className="px-3 py-4 text-[13px] text-ink-48">没有匹配结果</p>}
            {results.map((result, resultIndex) => (
              <button
                type="button"
                key={`${result.kind}:${result.id}`}
                data-index={resultIndex}
                className={`block w-full rounded-utility px-3 py-2 text-left ${resultIndex === index ? "bg-fill" : "hover:bg-fill/60"}`}
                onMouseEnter={() => setIndex(resultIndex)}
                onClick={() => execute(result)}
              >
                <span className="block text-[14px] text-ink">{result.title}</span>
                <span className="block text-[12px] text-ink-48">{result.detail}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}

export { ACTION_IDS };
