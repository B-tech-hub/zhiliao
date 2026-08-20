"use client";

// AI 助手面板：全局作用域，当前笔记/主题作为可摘除的上下文附件。
// 消息流里除了对话气泡，还有工具执行的操作卡片与删除确认卡片。
// 输入区是一体化输入卡：上半多行输入，下半控件行（上下文附件、来源集、看图开关都收在这里）。

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BodyPortal } from "@/components/body-portal";
import { MarkdownView } from "@/components/markdown-view";
import type { SourceItem } from "@/lib/ai/sources";
import { onAskWithSources } from "./ask-with-sources";
import { useChatScope } from "./chat-scope";
import {
  citationsToMarkdown,
  collectNoteIds,
  toolLabel,
  type ToolItem,
} from "./chat-state";
import { SourcePicker } from "./source-picker";
import { useChat } from "./use-chat";

// 输入框自增高的上限，约五行正文
const INPUT_MAX_HEIGHT = 132;

/* 抽屉宽度。默认 560——420 装不下带表格和代码块的回答，而回答现在是
   文档式排版，宽度直接决定可读性。上限 900 是为了别把正文页整个盖住。 */
const PANEL_WIDTH = { min: 420, max: 900, default: 560 } as const;
const PANEL_WIDTH_KEY = "zhiliao.chatPanelWidth";

/* 拖拽调宽。宽度存 localStorage：面板是每天都要开的东西，
   每次开都得重新拖一遍，比不能调还烦。 */
function usePanelWidth() {
  const [width, setWidth] = useState<number>(PANEL_WIDTH.default);
  const [dragging, setDragging] = useState(false);
  /* 拖拽结束后要吞掉紧接着的那次遮罩点击。浏览器把 click 派发到 mousedown 与
     mouseup 的共同祖先——把手在面板内、松手却常落在面板外的遮罩上，共同祖先
     就是遮罩本身，面板上的 stopPropagation 拦不住，结果「往左拖宽」变成「关闭面板」。
     用时间窗而不是一次性标志位：松手若落在面板内，那次 click 根本不会走到遮罩，
     标志位没人消费就会赖着，把用户下一次真心想关的点击白白吞掉。 */
  const dragEndedAt = useRef(0);

  // 首屏读 localStorage 而非用 useState 初始值：服务端渲染时没有 window
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (saved >= PANEL_WIDTH.min && saved <= PANEL_WIDTH.max) setWidth(saved);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    let moved = false;
    // 面板贴右边缘，所以宽度是「视口宽 - 指针横坐标」
    const onMove = (e: PointerEvent) => {
      moved = true;
      setWidth(
        Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, window.innerWidth - e.clientX)),
      );
    };
    const onUp = () => {
      // 只有真的拖动过才记时刻：单纯点一下把手不该影响后续的关闭点击
      if (moved) dragEndedAt.current = Date.now();
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    /* 拖拽时禁掉全局文字选中：否则划过正文会选中一大片蓝 */
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = "";
    };
  }, [dragging]);

  // 只在松手时写入，拖拽过程中不必每帧落盘
  useEffect(() => {
    if (!dragging) window.localStorage.setItem(PANEL_WIDTH_KEY, String(width));
  }, [dragging, width]);

  /* 遮罩点击是否应被忽略。只挡拖拽刚结束那一瞬间的合成点击——
     人不可能在松手后 150ms 内又有意去点遮罩。 */
  const shouldIgnoreOverlayClick = () => Date.now() - dragEndedAt.current < 150;

  return { width, dragging, startDrag: () => setDragging(true), shouldIgnoreOverlayClick };
}

export function ChatPanel({
  visionAvailable,
  reasoningAvailable,
  toolSupport,
}: {
  visionAvailable?: boolean;
  reasoningAvailable?: boolean;
  // 模型是否支持工具调用：false 已探测且不支持，null 从未探测过
  toolSupport?: boolean | null;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [useVision, setUseVision] = useState(false);
  const [useReasoning, setUseReasoning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // 来源选择器：null 关闭，数组是打开时的初始选中（新建为空，改来源时是当前来源集）
  const [picking, setPicking] = useState<SourceItem[] | null>(null);
  const [showSources, setShowSources] = useState(false);
  // 用户手动摘除了上下文附件（本次页面停留期间有效）
  const [detached, setDetached] = useState(false);
  /* 生成图片的落库状态，按卡片 callId 记。「插入笔记」不进操作卡片体系：
     它是用户自己点的一次普通编辑，笔记页照常可撤销（Ctrl+Z）或手动删掉那行。 */
  const [saving, setSaving] = useState<Record<string, "busy" | "done" | "error">>({});
  const [savingText, setSavingText] = useState<
    Record<number, { state: "busy" | "done" | "error"; noteId?: string }>
  >({});
  const { scope } = useChatScope();
  const { width, dragging, startDrag, shouldIgnoreOverlayClick } = usePanelWidth();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 换了笔记/主题就重新附上——新页面带来的是另一份上下文
  useEffect(() => setDetached(false), [scope?.id]);

  const chat = useChat(scope && !detached ? scope.type : "global", scope?.id ?? "");
  // 来源问答期间不显示页面附件：来源集是唯一的知识边界，两条上下文同时挂着只会让人搞不清 AI 看得见什么
  const attached = scope && !detached && !chat.grounded ? scope : null;

  // 会话切换后条目序号会复用，保存状态不能带到另一场会话。
  useEffect(() => setSavingText({}), [chat.conversationId]);

  // 面板打开时才拉会话列表，避免每次翻页都白白请求一次
  const { loadConversations } = chat;
  useEffect(() => {
    if (open) void loadConversations();
  }, [open, loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.items]);

  // 输入框随内容增高：先塌回 auto 量出真实 scrollHeight，再封顶
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [input, open]);

  /* 笔记页/主题页的「以此为来源提问」：直接开面板并预填来源，
     不弹选择器——用户已经表达了要问哪一份，再让他勾一次是多余的一步。 */
  const { startGrounded } = chat;
  useEffect(
    () =>
      onAskWithSources((picked) => {
        startGrounded(picked);
        setPicking(null);
        setShowHistory(false);
        setOpen(true);
      }),
    [startGrounded],
  );

  /* 引用溯源的白名单：工具真的返回过的笔记，加上当前附件那条
     （它是直接注入 system prompt 的，没经过工具，但引用它同样正当）。
     来源问答同理——来源全文直接进 system，服务端会回报展开后的笔记 id。 */
  const validNoteIds = useMemo(() => {
    const ids = collectNoteIds(chat.items, attached?.type === "note" ? attached.id : undefined);
    for (const id of chat.sourceNoteIds) ids.add(id);
    return ids;
  }, [chat.items, attached, chat.sourceNoteIds]);

  /* 空态文案随会话形态变：面向全库、围绕某条附件、只认来源集，
     这三种情形下助手能做什么完全不同，用同一句话打发等于什么都没说。 */
  const hero = useMemo(() => {
    if (chat.grounded) {
      return {
        title: "只从来源里回答",
        sub: "我只依据你选中的来源作答，来源里没有的会直说没有。",
        chips: ["总结这些来源的要点", "它们之间有什么关联"],
      };
    }
    if (attached) {
      return attached.type === "note"
        ? {
            title: "关于这条笔记",
            sub: "已带上当前笔记，也可以随时问整个知识库。",
            chips: ["总结这条笔记", "帮它挑几个标签", "顺着它再提几个问题"],
          }
        : {
            title: "关于这个主题",
            sub: "已带上当前主题，也可以随时问整个知识库。",
            chips: ["这个主题都记了什么", "梳理一条脉络"],
          };
    }
    return {
      title: "有什么可以帮你",
      sub: "面向整个知识库——问点什么，或让我帮你记一条、找一找、归归类。",
      chips: ["最近记了什么", "帮我记一条", "找找相关的笔记"],
    };
  }, [chat.grounded, attached]);

  const submit = () => {
    if (!input.trim() || chat.streaming) return;
    void chat.send(input, useVision, useReasoning);
    setInput("");
  };

  // 建议动作只是把话填进输入框，仍由用户按发送——不替用户做决定
  const fillInput = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  /* 把生成的图写进笔记。两个去处：追加到当前附件那条笔记，或新建一条。
     写的是 Markdown 图片引用，图片文件此前已落盘入库——
     一旦被正文引用，孤儿清扫就不会再碰它（判据是全库正文引用）。 */
  const saveImageTo = async (item: ToolItem, target: "current" | "new") => {
    if (!item.image || saving[item.callId] === "busy") return;
    const markdown = `![${item.image.alt}](${item.image.url})`;
    setSaving((s) => ({ ...s, [item.callId]: "busy" }));
    try {
      const res =
        target === "current" && attached?.type === "note"
          ? await fetch(`/api/notes/${attached.id}/append`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: markdown }),
            })
          : await fetch("/api/notes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: markdown }),
            });
      setSaving((s) => ({ ...s, [item.callId]: res.ok ? "done" : "error" }));
    } catch {
      setSaving((s) => ({ ...s, [item.callId]: "error" }));
    }
  };

  const saveAssistantText = async (content: string, itemIndex: number) => {
    if (!content.trim() || savingText[itemIndex]?.state === "busy") return;
    setSavingText((state) => ({ ...state, [itemIndex]: { state: "busy" } }));
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      if (!res.ok || !data.id) throw new Error("保存失败");
      setSavingText((state) => ({
        ...state,
        [itemIndex]: { state: "done", noteId: data.id },
      }));
    } catch {
      setSavingText((state) => ({ ...state, [itemIndex]: { state: "error" } }));
    }
  };

  const hasImages = Boolean(attached?.hasImages);
  const showVisionToggle = hasImages && attached?.type === "note";
  // 等待首个字符时给个占位，否则点了发送像是没反应
  const waiting = chat.streaming && chat.items[chat.items.length - 1]?.kind !== "text";

  return (
    <BodyPortal>
      {/* 唤起按钮：与右下角"快速记录"钮横向并排贴底（Portal 到 body，避开 template 的 transform 动画劫持 fixed 定位） */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-[5.5rem] z-20 flex h-12 w-12 items-center justify-center rounded-full bg-chrome text-white shadow-lg transition-transform active:scale-95 dark:ring-1 dark:ring-white/15 md:bottom-10 md:right-[6.75rem]"
        aria-label="AI 助手"
        title="AI 助手"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
          <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 flex justify-end bg-black/20"
          onClick={() => {
            // 刚拖完宽度的那次点击不算「点了遮罩要关闭」
            if (shouldIgnoreOverlayClick()) return;
            setOpen(false);
          }}
        >
          <div
            className="relative flex h-full w-full flex-col bg-surface shadow-2xl md:w-[var(--panel-w)]"
            style={{ "--panel-w": `${width}px` } as React.CSSProperties}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 拖拽把手：贴左边缘的一条窄带，移动端不给——那里面板本就全宽 */}
            <div
              onPointerDown={(e) => {
                e.preventDefault();
                startDrag();
              }}
              className={`absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize md:block ${
                dragging ? "bg-action/40" : "hover:bg-action/25"
              }`}
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动调整助手面板宽度"
            />
            {picking !== null ? (
              <SourcePicker
                initial={picking}
                onCancel={() => setPicking(null)}
                onConfirm={(items) => {
                  // 已有会话时是改来源（落库，下条消息生效），否则开一场新的来源问答
                  if (chat.grounded && chat.conversationId) void chat.updateSources(items);
                  else chat.startGrounded(items);
                  setPicking(null);
                  setShowHistory(false);
                }}
              />
            ) : (
              <>
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-divider px-5 py-4">
              <p className="text-[14px] font-semibold tracking-[-0.224px]">AI 助手</p>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="rounded-utility px-2 py-1 text-[12px] text-ink-48 hover:bg-fill"
                >
                  历史
                </button>
                <button
                  onClick={() => {
                    void chat.openConversation(null);
                    setShowHistory(false);
                  }}
                  className="rounded-utility px-2 py-1 text-[12px] text-action hover:bg-fill"
                >
                  新对话
                </button>
                <button
                  onClick={() => {
                    setPicking([]);
                    setShowHistory(false);
                  }}
                  className="rounded-utility px-2 py-1 text-[12px] text-action hover:bg-fill"
                  title="选几条笔记或主题作为来源，AI 只依据它们回答"
                >
                  来源问答
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-utility px-2 py-1 text-[14px] text-ink-48 hover:bg-fill"
                  aria-label="关闭"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 来源超预算：正文没进 prompt，靠工具按需取；没有工具就真看不全 */}
            {chat.sourcesTruncated && (
              <p className="border-b border-divider bg-fill/40 px-5 py-2 text-[12px] leading-[1.5] text-ink-48">
                {toolSupport === false
                  ? "来源集过大，只有标题与摘要进入了上下文，且当前模型不支持工具调用，正文不可见。建议减少来源。"
                  : "来源集过大，正文未全部载入，AI 会按需检索来源内容。"}
              </p>
            )}

            {/* 工具能力降级提示 */}
            {toolSupport === false && (
              <p className="border-b border-divider bg-fill/40 px-5 py-2 text-[12px] text-ink-48">
                当前模型不支持工具调用，已降级为纯问答（无法检索或整理笔记）。
              </p>
            )}
            {toolSupport === null && (
              <p className="border-b border-divider bg-fill/40 px-5 py-2 text-[12px] text-ink-48">
                还没测过当前模型是否支持工具调用，建议到{" "}
                <Link href="/settings" onClick={() => setOpen(false)} className="text-action underline">
                  设置
                </Link>{" "}
                点一次「测试连接」。
              </p>
            )}

            {/* 历史会话列表 */}
            {showHistory && (
              <div className="max-h-48 overflow-y-auto border-b border-divider">
                {chat.conversationList.length === 0 ? (
                  <p className="px-5 py-3 text-[12px] text-ink-48">还没有历史会话</p>
                ) : (
                  chat.conversationList.map((c) => (
                    <div
                      key={c.id}
                      className={`flex items-center justify-between px-5 py-2 text-[13px] hover:bg-fill/60 ${
                        c.id === chat.conversationId ? "bg-fill/60 font-semibold" : ""
                      }`}
                    >
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          void chat.openConversation(c.id);
                          setShowHistory(false);
                        }}
                      >
                        <span className="block truncate">{c.title || "（无标题）"}</span>
                        {c.scopeLabel && (
                          <span className="block truncate text-[11px] text-ink-48">
                            围绕：{c.scopeLabel}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => void chat.removeConversation(c.id)}
                        className="shrink-0 pl-2 text-[12px] text-ink-48 hover:text-danger"
                      >
                        删除
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* 消息区。空态要整屏居中，此时容器自己做垂直居中——
                若靠子元素 min-h-full，百分比高度按内容盒算，会连同 py-4 一起溢出多出一条滚动条 */}
            <div
              className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 ${
                chat.items.length === 0 ? "flex flex-col justify-center" : "space-y-3"
              }`}
            >
              {chat.items.length === 0 ? (
                <div className="flex flex-col items-center gap-5 text-center">
                  <div className="space-y-2">
                    <p className="text-[21px] font-semibold tracking-[-0.374px]">{hero.title}</p>
                    <p className="mx-auto max-w-[17em] text-[14px] leading-[1.43] tracking-[-0.224px] text-ink-48">
                      {hero.sub}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {hero.chips.map((c) => (
                      <button
                        key={c}
                        onClick={() => fillInput(c)}
                        className="rounded-utility border border-hairline px-3 py-1.5 text-[13px] text-ink-80 transition-colors hover:bg-fill active:scale-95"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chat.items.map((item, i) =>
                  item.kind === "tool" ? (
                    <ToolCard
                      key={`${item.callId}-${i}`}
                      item={item}
                      busy={chat.streaming}
                      undoing={chat.undoing === item.messageId}
                      onUndo={() => item.messageId && void chat.undo(item.messageId)}
                      onRespond={(approve) => void chat.respondConfirm(item, approve)}
                      attachedNoteTitle={attached?.type === "note" ? attached.title : undefined}
                      saveState={saving[item.callId]}
                      onSaveImage={(target) => void saveImageTo(item, target)}
                    />
                  ) : (
                    <div
                      key={i}
                      className={
                        item.role === "user" ? "flex justify-end" : "flex flex-col items-start gap-1.5"
                      }
                    >
                      {/* 思考过程排在回答之上：它是回答的来路，读起来才顺 */}
                      {item.role === "assistant" && item.reasoning && (
                        <ReasoningPanel
                          text={item.reasoning}
                          active={chat.streaming && i === chat.items.length - 1 && !item.content}
                        />
                      )}
                      {/* 只有思考过程、还没吐正文的那一瞬间不画气泡 */}
                      {(item.role === "user" || item.content) &&
                        (item.role === "user" ? (
                          <div className="max-w-[85%] whitespace-pre-wrap rounded-card bg-action px-3.5 py-2 text-[15px] leading-[1.5] text-white dark:text-cta-ink">
                            {item.content}
                          </div>
                        ) : (
                          /* 助手回答不套气泡：它常常是带标题、列表、表格、代码块的
                             一整篇文档，塞进 85% 宽的圆角气泡里读起来是一坨。
                             改为占满宽度、走共享排版层，与笔记正文同一套节奏。 */
                          <div className="w-full text-[15px] leading-[1.6] text-ink-80">
                            <MarkdownView
                              text={citationsToMarkdown(item.content, validNoteIds)}
                              streaming={chat.streaming && i === chat.items.length - 1}
                              onNavigate={() => setOpen(false)}
                            />
                            {/* 流断在半途：说清楚这段话可能没说完，别让用户当成完整回答 */}
                            {item.truncated && (
                              <span className="mt-1 block text-[12px] text-ink-48">
                                回答可能不完整
                              </span>
                            )}
                            {!item.truncated && (
                              <div className="mt-2 text-[12px]">
                                {savingText[i]?.state === "done" && savingText[i]?.noteId ? (
                                  <Link
                                    href={`/notes/${savingText[i].noteId}`}
                                    onClick={() => setOpen(false)}
                                    className="text-action"
                                  >
                                    已存为新笔记，点击查看
                                  </Link>
                                ) : (
                                  <button
                                    onClick={() => void saveAssistantText(item.content, i)}
                                    disabled={chat.streaming || savingText[i]?.state === "busy"}
                                    className="text-action disabled:opacity-40"
                                  >
                                    {savingText[i]?.state === "busy" ? "保存中…" : "存为新笔记"}
                                  </button>
                                )}
                                {savingText[i]?.state === "error" && (
                                  <span className="ml-2 text-danger">保存失败，请重试</span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  ),
                )
              )}
              {waiting && (
                <div className="flex justify-start">
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-card bg-fill px-3.5 py-2 text-[14px] text-ink-48"
                  >
                    <Spinner className="text-action" />
                    思考中…
                  </div>
                </div>
              )}
              {chat.error && <p className="text-[12px] text-danger">{chat.error}</p>}
              <div ref={bottomRef} />
            </div>

            {/* 输入区：一体化输入卡 */}
            <div className="p-3">
              {/* 来源集详情：由控件行的来源 chip 展开。接地会话的知识边界，随时可查可改 */}
              {chat.grounded && showSources && (
                <div className="mb-2 rounded-card border border-hairline bg-fill/40 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-action">来源集</span>
                    <button
                      onClick={() => setPicking(chat.sources)}
                      className="shrink-0 rounded-utility px-2 py-0.5 text-[12px] text-action hover:bg-fill"
                    >
                      改来源
                    </button>
                  </div>
                  {chat.sources.length === 0 ? (
                    <p className="mt-1 text-[12px] text-ink-48">还没有选择来源。</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {chat.sources.map((s) => (
                        <li key={`${s.type}:${s.id}`} className="flex items-center gap-1.5 text-[12px]">
                          <span className="shrink-0 text-ink-48">{s.type === "topic" ? "主题" : "笔记"}</span>
                          <span className="min-w-0 truncate">{s.label}</span>
                          {s.deleted && <span className="shrink-0 text-ink-48">（在回收站，暂不参与回答）</span>}
                          {s.missing && <span className="shrink-0 text-ink-48">（已删除）</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1.5 text-[11px] leading-[1.5] text-ink-48">
                    AI 只依据这些来源回答，来源里没有的会直说没有。
                  </p>
                </div>
              )}

              <div className="rounded-card border border-hairline bg-surface transition-colors focus-within:border-action-focus">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={1}
                  placeholder="问点什么，Enter 发送"
                  className="block w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[17px] leading-[1.47] tracking-[-0.374px] outline-none placeholder:text-ink-48"
                  style={{ maxHeight: INPUT_MAX_HEIGHT }}
                />

                {/* 控件行：上下文附件、来源集、看图开关都是 chip，右侧发送 */}
                <div className="flex items-end gap-2 px-2 pb-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {/* 上下文附件：摘除后助手只面向整个知识库 */}
                    {attached && (
                      <span className="flex max-w-full items-center gap-1 rounded-chip border border-hairline py-1 pl-2.5 pr-1 text-[12px] text-ink-80">
                        <span className="shrink-0 text-ink-48">
                          {attached.type === "note" ? "笔记" : "主题"}
                        </span>
                        <span className="min-w-0 max-w-[140px] truncate">{attached.title}</span>
                        <button
                          onClick={() => setDetached(true)}
                          className="shrink-0 rounded-chip px-1 text-ink-48 hover:text-ink-80"
                          title="不带这条上下文，改为面向整个知识库"
                          aria-label="移除上下文附件"
                        >
                          ✕
                        </button>
                      </span>
                    )}
                    {scope && detached && !chat.grounded && (
                      <button
                        onClick={() => setDetached(false)}
                        className="flex shrink-0 items-center gap-1 rounded-utility border border-hairline px-2.5 py-1 text-[12px] text-ink-48 transition-colors hover:bg-fill active:scale-95"
                        title={`把当前${scope.type === "note" ? "笔记" : "主题"}加回上下文`}
                      >
                        ＋ 当前{scope.type === "note" ? "笔记" : "主题"}
                      </button>
                    )}

                    {/* 来源集：接地会话的知识边界，chip 常驻可见，点开看明细 */}
                    {chat.grounded && (
                      <button
                        onClick={() => setShowSources((v) => !v)}
                        className={`flex shrink-0 items-center gap-1 rounded-utility px-2.5 py-1 text-[12px] transition-colors active:scale-95 ${
                          showSources ? "bg-action/10 text-action" : "border border-hairline text-action hover:bg-fill"
                        }`}
                        title="查看或修改来源集"
                      >
                        来源 · {chat.sources.length}
                      </button>
                    )}

                    {/* 看图开关 */}
                    {showVisionToggle && (
                      <button
                        onClick={() => visionAvailable && setUseVision((v) => !v)}
                        disabled={!visionAvailable}
                        className={`flex shrink-0 items-center gap-1 rounded-utility px-2.5 py-1 text-[12px] transition-colors active:scale-95 disabled:opacity-40 ${
                          useVision && visionAvailable
                            ? "bg-action/10 text-action"
                            : "border border-hairline text-ink-48 hover:bg-fill"
                        }`}
                        title={visionAvailable ? "让 AI 查看笔记中的图片" : "请先在设置页配置视觉模型"}
                      >
                        看图{visionAvailable ? "" : "（未配置）"}
                      </button>
                    )}
                    {/* 深度思考开关。未配置推理模型时置灰——原先它照常亮着，
                        点了静默无效，用户只会以为功能坏了 */}
                    <button
                      onClick={() => reasoningAvailable && setUseReasoning((v) => !v)}
                      disabled={!reasoningAvailable}
                      className={`flex shrink-0 items-center gap-1 rounded-utility px-2.5 py-1 text-[12px] transition-colors active:scale-95 disabled:opacity-40 ${
                        useReasoning && reasoningAvailable
                          ? "bg-action/10 text-action"
                          : "border border-hairline text-ink-48 hover:bg-fill"
                      }`}
                      title={
                        reasoningAvailable
                          ? "本次消息改用独立的推理模型作答，并显示它的思考过程"
                          : "请先在设置页配置深度思考模型"
                      }
                    >
                      深度思考{reasoningAvailable ? "" : "（未配置）"}
                    </button>
                  </div>

                  {chat.streaming ? (
                    <button
                      onClick={chat.stop}
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-utility border border-hairline px-3.5 text-[13px] text-ink-48 active:scale-95"
                    >
                      <Spinner className="text-action" />
                      停止
                    </button>
                  ) : (
                    <button
                      onClick={submit}
                      disabled={!input.trim()}
                      className="h-8 shrink-0 rounded-utility bg-cta px-4 text-[13px] text-cta-ink active:scale-95 disabled:opacity-40"
                    >
                      发送
                    </button>
                  )}
                </div>
              </div>
            </div>
              </>
            )}
          </div>
        </div>
      )}
    </BodyPortal>
  );
}

const CARD_BASE = "rounded-card border px-3 py-2 text-[13px] leading-[1.5]";

/* 思考过程的折叠栏。展开策略是「跟着注意力走」：模型还在想时自动展开——
   那正是用户唯一想看它的时刻；正文一开始吐就自动收起，把版面让给答案。
   收起后仍可手动点开，重开历史会话时默认收起。 */
function ReasoningPanel({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(active);
  // 手动开合后不再被自动策略覆盖——用户的意图优先于默认行为
  const touched = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!touched.current) setOpen(active);
  }, [active]);

  // 展开时思考过程持续追加，把视口钉在最新一行，否则读到的永远是开头
  useEffect(() => {
    if (open && active && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, open, active]);

  return (
    <div className="w-full max-w-[85%] rounded-card border border-hairline/70 bg-fill/30">
      <button
        onClick={() => {
          touched.current = true;
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[12px] text-ink-48 transition-colors hover:text-ink-80"
      >
        {active ? <Spinner className="text-action" /> : <span aria-hidden>✻</span>}
        <span>{active ? "思考中…" : "已思考"}</span>
        <span aria-hidden className="ml-auto text-[10px]">
          {open ? "收起" : "展开"}
        </span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t border-hairline/70 px-3 py-2 text-[12px] leading-[1.6] text-ink-48"
        >
          {text}
        </div>
      )}
    </div>
  );
}

/* 思考中的字符动画。原先等待首个字符只有一个静态「…」，模型想十几秒
   与卡死没有区别——用户会以为功能坏了，实际它正在调工具或组织语言。
   字符序列是「绽放—收缩」的循环，同 Claude Code 的 spinner 一个路数。 */
const SPIN_FRAMES = ["✻", "✽", "✻", "∗", "✳", "✢", "·", "✢", "✳", "∗"];

function Spinner({ className = "" }: { className?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    // 尊重系统的「减弱动效」偏好：此时停在第一帧，不做定时切换
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setFrame((v) => (v + 1) % SPIN_FRAMES.length), 110);
    return () => clearInterval(timer);
  }, []);
  // 各帧字宽不等，固定宽度并居中，否则相邻文字会跟着左右抖
  return (
    <span aria-hidden className={`inline-block w-[1em] shrink-0 text-center ${className}`}>
      {SPIN_FRAMES[frame]}
    </span>
  );
}

// 操作卡片与确认卡片。六种状态在 chat-state 里判定好了，这里只负责画
function ToolCard({
  item,
  busy,
  undoing,
  onUndo,
  onRespond,
  attachedNoteTitle,
  saveState,
  onSaveImage,
}: {
  item: ToolItem;
  busy: boolean;
  undoing: boolean;
  onUndo: () => void;
  onRespond: (approve: boolean) => void;
  // 有值表示当前挂着一条笔记附件，可以「插入当前笔记」
  attachedNoteTitle?: string;
  saveState?: "busy" | "done" | "error";
  onSaveImage: (target: "current" | "new") => void;
}) {
  if (item.status === "pending") {
    return (
      <div className={`${CARD_BASE} border-action/40 bg-action/[0.06]`}>
        <p className="font-medium">助手请求{item.summary}</p>
        <p className="mt-0.5 text-[12px] text-ink-48">删除会移入回收站，30 天内可恢复。</p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => onRespond(true)}
            disabled={busy}
            className="rounded-utility bg-cta px-3 py-1 text-[12px] text-cta-ink active:scale-95 disabled:opacity-40"
          >
            允许
          </button>
          <button
            onClick={() => onRespond(false)}
            disabled={busy}
            className="rounded-utility border border-hairline px-3 py-1 text-[12px] text-ink-48 active:scale-95 disabled:opacity-40"
          >
            拒绝
          </button>
        </div>
      </div>
    );
  }

  const title =
    item.status === "running" ? `正在${toolLabel(item.name)}…` : item.summary || toolLabel(item.name);

  return (
    <div className={`${CARD_BASE} border-hairline bg-fill/40`}>
      <div className="flex items-start gap-1.5">
        {item.status === "running" ? (
          <Spinner className="text-action" />
        ) : (
          <span aria-hidden className={item.status === "ok" ? "text-action" : "text-ink-48"}>
            {item.status === "ok" ? "✓" : "✗"}
          </span>
        )}
        <span className={`min-w-0 flex-1 ${item.status === "failed" ? "text-ink-48" : ""}`}>
          {title}
        </span>
        {item.undo === "available" && (
          <button
            onClick={onUndo}
            disabled={undoing}
            className="shrink-0 rounded-utility px-2 py-0.5 text-[12px] text-action hover:bg-fill disabled:opacity-40"
          >
            {undoing ? "撤销中…" : "撤销"}
          </button>
        )}
        {item.undo === "undone" && <span className="shrink-0 text-[12px] text-ink-48">已撤销</span>}
      </div>
      {/* 撤销被拒：原因来自服务端，多半是「笔记已被修改」 */}
      {item.undo === "rejected" && (
        <p className="mt-1 pl-4 text-[12px] text-ink-48">{item.undoReason || "无法撤销"}</p>
      )}

      {/* 生成的图片。生图本身没有撤销——钱已经花了，撤不回来；
          图若一直没被写进笔记，24 小时后由孤儿清扫自然回收 */}
      {item.image && item.status === "ok" && (
        <div className="mt-2 pl-4">
          {/* 生成图不是产品照，用普通 img：next/image 需要配置远端域名且本项目未启用 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.image.url}
            alt={item.image.alt}
            className="max-h-64 w-full rounded-utility object-contain"
          />
          {saveState === "done" ? (
            <p className="mt-1.5 text-[12px] text-ink-48">已存入笔记</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {attachedNoteTitle && (
                <button
                  onClick={() => onSaveImage("current")}
                  disabled={saveState === "busy"}
                  className="rounded-utility bg-cta px-3 py-1 text-[12px] text-cta-ink active:scale-95 disabled:opacity-40"
                  title={`追加到「${attachedNoteTitle}」的正文末尾`}
                >
                  插入当前笔记
                </button>
              )}
              <button
                onClick={() => onSaveImage("new")}
                disabled={saveState === "busy"}
                className="rounded-utility border border-hairline px-3 py-1 text-[12px] text-ink-80 active:scale-95 disabled:opacity-40"
              >
                存为新笔记
              </button>
              {saveState === "busy" && <span className="text-[12px] text-ink-48">保存中…</span>}
              {saveState === "error" && <span className="text-[12px] text-danger">保存失败</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
