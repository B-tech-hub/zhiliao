"use client";

// AI 助手面板：全局作用域，当前笔记/主题作为可摘除的上下文附件。
// 消息流里除了对话气泡，还有工具执行的操作卡片与删除确认卡片。
// 输入区是一体化输入卡：上半多行输入，下半控件行（上下文附件、来源集、看图开关都收在这里）。

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BodyPortal } from "@/components/body-portal";
import type { SourceItem } from "@/lib/ai/sources";
import { onAskWithSources } from "./ask-with-sources";
import { useChatScope } from "./chat-scope";
import {
  collectNoteIds,
  splitCitations,
  toolLabel,
  type ToolItem,
} from "./chat-state";
import { SourcePicker } from "./source-picker";
import { useChat } from "./use-chat";

// 输入框自增高的上限，约五行正文
const INPUT_MAX_HEIGHT = 132;

export function ChatPanel({
  visionAvailable,
  toolSupport,
}: {
  visionAvailable?: boolean;
  // 模型是否支持工具调用：false 已探测且不支持，null 从未探测过
  toolSupport?: boolean | null;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [useVision, setUseVision] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // 来源选择器：null 关闭，数组是打开时的初始选中（新建为空，改来源时是当前来源集）
  const [picking, setPicking] = useState<SourceItem[] | null>(null);
  const [showSources, setShowSources] = useState(false);
  // 用户手动摘除了上下文附件（本次页面停留期间有效）
  const [detached, setDetached] = useState(false);
  /* 生成图片的落库状态，按卡片 callId 记。「插入笔记」不进操作卡片体系：
     它是用户自己点的一次普通编辑，笔记页照常可撤销（Ctrl+Z）或手动删掉那行。 */
  const [saving, setSaving] = useState<Record<string, "busy" | "done" | "error">>({});
  const { scope } = useChatScope();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 换了笔记/主题就重新附上——新页面带来的是另一份上下文
  useEffect(() => setDetached(false), [scope?.id]);

  const chat = useChat(scope && !detached ? scope.type : "global", scope?.id ?? "");
  // 来源问答期间不显示页面附件：来源集是唯一的知识边界，两条上下文同时挂着只会让人搞不清 AI 看得见什么
  const attached = scope && !detached && !chat.grounded ? scope : null;

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
    void chat.send(input, useVision);
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
        <div className="fixed inset-0 z-30 flex justify-end bg-black/20" onClick={() => setOpen(false)}>
          <div
            className="flex h-full w-full max-w-[420px] flex-col bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
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
                  className="rounded-full px-2 py-1 text-[12px] text-ink-48 hover:bg-fill"
                >
                  历史
                </button>
                <button
                  onClick={() => {
                    void chat.openConversation(null);
                    setShowHistory(false);
                  }}
                  className="rounded-full px-2 py-1 text-[12px] text-action hover:bg-fill"
                >
                  新对话
                </button>
                <button
                  onClick={() => {
                    setPicking([]);
                    setShowHistory(false);
                  }}
                  className="rounded-full px-2 py-1 text-[12px] text-action hover:bg-fill"
                  title="选几条笔记或主题作为来源，AI 只依据它们回答"
                >
                  来源问答
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-full px-2 py-1 text-[14px] text-ink-48 hover:bg-fill"
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
                        className="rounded-full border border-hairline px-3 py-1.5 text-[13px] text-ink-80 transition-colors hover:bg-fill active:scale-95"
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
                    <div key={i} className={item.role === "user" ? "flex justify-end" : "flex justify-start"}>
                      <div
                        className={`max-w-[85%] whitespace-pre-wrap rounded-[18px] px-3.5 py-2 text-[14px] leading-[1.5] ${
                          item.role === "user" ? "bg-action text-white" : "bg-fill text-ink-80"
                        }`}
                      >
                        {item.role === "assistant" ? (
                          <Citations text={item.content} valid={validNoteIds} onNavigate={() => setOpen(false)} />
                        ) : (
                          item.content
                        )}
                        {/* 流断在半途：说清楚这段话可能没说完，别让用户当成完整回答 */}
                        {item.truncated && (
                          <span className="mt-1 block text-[12px] text-ink-48">回答可能不完整</span>
                        )}
                      </div>
                    </div>
                  ),
                )
              )}
              {waiting && (
                <div className="flex justify-start">
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-[18px] bg-fill px-3.5 py-2 text-[14px] text-ink-48"
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
                <div className="mb-2 rounded-[18px] border border-hairline bg-fill/40 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-action">来源集</span>
                    <button
                      onClick={() => setPicking(chat.sources)}
                      className="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-action hover:bg-fill"
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

              <div className="rounded-[18px] border border-hairline bg-surface transition-colors focus-within:border-action-focus">
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
                      <span className="flex max-w-full items-center gap-1 rounded-full border border-hairline py-1 pl-2.5 pr-1 text-[12px] text-ink-80">
                        <span className="shrink-0 text-ink-48">
                          {attached.type === "note" ? "笔记" : "主题"}
                        </span>
                        <span className="min-w-0 max-w-[140px] truncate">{attached.title}</span>
                        <button
                          onClick={() => setDetached(true)}
                          className="shrink-0 rounded-full px-1 text-ink-48 hover:text-ink-80"
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
                        className="flex shrink-0 items-center gap-1 rounded-full border border-hairline px-2.5 py-1 text-[12px] text-ink-48 transition-colors hover:bg-fill active:scale-95"
                        title={`把当前${scope.type === "note" ? "笔记" : "主题"}加回上下文`}
                      >
                        ＋ 当前{scope.type === "note" ? "笔记" : "主题"}
                      </button>
                    )}

                    {/* 来源集：接地会话的知识边界，chip 常驻可见，点开看明细 */}
                    {chat.grounded && (
                      <button
                        onClick={() => setShowSources((v) => !v)}
                        className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] transition-colors active:scale-95 ${
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
                        className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] transition-colors active:scale-95 disabled:opacity-40 ${
                          useVision && visionAvailable
                            ? "bg-action/10 text-action"
                            : "border border-hairline text-ink-48 hover:bg-fill"
                        }`}
                        title={visionAvailable ? "让 AI 查看笔记中的图片" : "请先在设置页配置视觉模型"}
                      >
                        看图{visionAvailable ? "" : "（未配置）"}
                      </button>
                    )}
                  </div>

                  {chat.streaming ? (
                    <button
                      onClick={chat.stop}
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-hairline px-3.5 text-[13px] text-ink-48 active:scale-95"
                    >
                      <Spinner className="text-action" />
                      停止
                    </button>
                  ) : (
                    <button
                      onClick={submit}
                      disabled={!input.trim()}
                      className="h-8 shrink-0 rounded-full bg-action px-4 text-[13px] text-white active:scale-95 disabled:opacity-40"
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

/* 引用标记渲染成上标序号链接。白名单外的标记已在 splitCitations 里
   降级为普通文本，这里拿到的每个 noteId 都对应真实存在的笔记。 */
function Citations({
  text,
  valid,
  onNavigate,
}: {
  text: string;
  valid: ReadonlySet<string>;
  onNavigate: () => void;
}) {
  let n = 0;
  return (
    <>
      {splitCitations(text, valid).map((seg, i) => {
        if (!seg.noteId) return <span key={i}>{seg.text}</span>;
        n += 1;
        return (
          <Link
            key={i}
            href={`/notes/${seg.noteId}`}
            onClick={onNavigate}
            title="打开被引用的笔记"
            className="mx-0.5 align-super text-[11px] text-action underline"
          >
            [{n}]
          </Link>
        );
      })}
    </>
  );
}

const CARD_BASE = "rounded-[18px] border px-3 py-2 text-[13px] leading-[1.5]";

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
            className="rounded-full bg-action px-3 py-1 text-[12px] text-white active:scale-95 disabled:opacity-40"
          >
            允许
          </button>
          <button
            onClick={() => onRespond(false)}
            disabled={busy}
            className="rounded-full border border-hairline px-3 py-1 text-[12px] text-ink-48 active:scale-95 disabled:opacity-40"
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
            className="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-action hover:bg-fill disabled:opacity-40"
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
            className="max-h-64 w-full rounded-[8px] object-contain"
          />
          {saveState === "done" ? (
            <p className="mt-1.5 text-[12px] text-ink-48">已存入笔记</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {attachedNoteTitle && (
                <button
                  onClick={() => onSaveImage("current")}
                  disabled={saveState === "busy"}
                  className="rounded-full bg-action px-3 py-1 text-[12px] text-white active:scale-95 disabled:opacity-40"
                  title={`追加到「${attachedNoteTitle}」的正文末尾`}
                >
                  插入当前笔记
                </button>
              )}
              <button
                onClick={() => onSaveImage("new")}
                disabled={saveState === "busy"}
                className="rounded-full border border-hairline px-3 py-1 text-[12px] text-ink-80 active:scale-95 disabled:opacity-40"
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
