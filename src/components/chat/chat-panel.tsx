"use client";

// AI 助手面板：全局作用域，当前笔记/主题作为可摘除的上下文附件。
// 消息流里除了对话气泡，还有工具执行的操作卡片与删除确认卡片。

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BodyPortal } from "@/components/body-portal";
import { useChatScope } from "./chat-scope";
import {
  collectNoteIds,
  splitCitations,
  toolLabel,
  type ToolItem,
} from "./chat-state";
import { useChat } from "./use-chat";

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
  // 用户手动摘除了上下文附件（本次页面停留期间有效）
  const [detached, setDetached] = useState(false);
  const { scope } = useChatScope();
  const bottomRef = useRef<HTMLDivElement>(null);

  // 换了笔记/主题就重新附上——新页面带来的是另一份上下文
  useEffect(() => setDetached(false), [scope?.id]);

  const attached = scope && !detached ? scope : null;
  const chat = useChat(attached?.type ?? "global", attached?.id ?? "");

  // 面板打开时才拉会话列表，避免每次翻页都白白请求一次
  const { loadConversations } = chat;
  useEffect(() => {
    if (open) void loadConversations();
  }, [open, loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.items]);

  /* 引用溯源的白名单：工具真的返回过的笔记，加上当前附件那条
     （它是直接注入 system prompt 的，没经过工具，但引用它同样正当）。 */
  const validNoteIds = useMemo(
    () => collectNoteIds(chat.items, attached?.type === "note" ? attached.id : undefined),
    [chat.items, attached],
  );

  const submit = () => {
    if (!input.trim() || chat.streaming) return;
    void chat.send(input, useVision);
    setInput("");
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
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-divider px-5 py-4">
              <p className="text-[14px] font-semibold tracking-[-0.224px]">AI 助手</p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="rounded-full px-2.5 py-1 text-[12px] text-ink-48 hover:bg-fill"
                >
                  历史
                </button>
                <button
                  onClick={() => {
                    void chat.openConversation(null);
                    setShowHistory(false);
                  }}
                  className="rounded-full px-2.5 py-1 text-[12px] text-action hover:bg-fill"
                >
                  新对话
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

            {/* 上下文附件条：摘除后助手只面向整个知识库 */}
            {attached && (
              <div className="flex items-center gap-2 border-b border-divider bg-fill/40 px-5 py-2">
                <span className="shrink-0 text-[12px] text-ink-48">
                  {attached.type === "note" ? "当前笔记" : "当前主题"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px]">{attached.title}</span>
                <button
                  onClick={() => setDetached(true)}
                  className="shrink-0 rounded-full px-1.5 text-[12px] text-ink-48 hover:bg-fill hover:text-ink-80"
                  title="不带这条上下文，改为面向整个知识库"
                  aria-label="移除上下文附件"
                >
                  ✕
                </button>
              </div>
            )}
            {scope && detached && (
              <button
                onClick={() => setDetached(false)}
                className="border-b border-divider px-5 py-2 text-left text-[12px] text-action hover:bg-fill/40"
              >
                ＋ 把当前{scope.type === "note" ? "笔记" : "主题"}加回上下文
              </button>
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

            {/* 消息区 */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {chat.items.length === 0 && (
                <p className="pt-8 text-center text-[13px] leading-[1.6] text-ink-48">
                  问点什么，或让我帮你记一条、找一找、归归类。
                </p>
              )}
              {chat.items.map((item, i) =>
                item.kind === "tool" ? (
                  <ToolCard
                    key={`${item.callId}-${i}`}
                    item={item}
                    busy={chat.streaming}
                    undoing={chat.undoing === item.messageId}
                    onUndo={() => item.messageId && void chat.undo(item.messageId)}
                    onRespond={(approve) => void chat.respondConfirm(item, approve)}
                  />
                ) : (
                  <div key={i} className={item.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-[14px] px-3.5 py-2 text-[14px] leading-[1.5] ${
                        item.role === "user" ? "bg-action text-white" : "bg-fill text-ink-80"
                      }`}
                    >
                      {item.role === "assistant" ? (
                        <Citations text={item.content} valid={validNoteIds} onNavigate={() => setOpen(false)} />
                      ) : (
                        item.content
                      )}
                    </div>
                  </div>
                ),
              )}
              {waiting && (
                <div className="flex justify-start">
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-[14px] bg-fill px-3.5 py-2 text-[14px] text-ink-48"
                  >
                    <Spinner className="text-action" />
                    思考中…
                  </div>
                </div>
              )}
              {chat.error && <p className="text-[12px] text-danger">{chat.error}</p>}
              <div ref={bottomRef} />
            </div>

            {/* 输入区 */}
            <div className="border-t border-divider p-4">
              {showVisionToggle && (
                <label
                  className={`mb-2 flex items-center gap-1.5 text-[12px] ${
                    visionAvailable ? "text-ink-48" : "text-ink-48/50"
                  }`}
                  title={visionAvailable ? "" : "请先在设置页配置视觉模型"}
                >
                  <input
                    type="checkbox"
                    checked={useVision && Boolean(visionAvailable)}
                    disabled={!visionAvailable}
                    onChange={(e) => setUseVision(e.target.checked)}
                  />
                  让 AI 查看笔记中的图片{visionAvailable ? "" : "（未配置视觉模型）"}
                </label>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={2}
                  placeholder="输入问题，Enter 发送"
                  className="max-h-32 flex-1 resize-none rounded-[12px] border border-hairline px-3 py-2 text-[14px] outline-none focus:border-action-focus"
                />
                {chat.streaming ? (
                  <button
                    onClick={chat.stop}
                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-hairline px-4 text-[13px] text-ink-48 active:scale-95"
                  >
                    <Spinner className="text-action" />
                    停止
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={!input.trim()}
                    className="h-9 shrink-0 rounded-full bg-action px-4 text-[13px] text-white active:scale-95 disabled:opacity-40"
                  >
                    发送
                  </button>
                )}
              </div>
            </div>
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

const CARD_BASE = "rounded-[12px] border px-3 py-2 text-[13px] leading-[1.5]";

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
}: {
  item: ToolItem;
  busy: boolean;
  undoing: boolean;
  onUndo: () => void;
  onRespond: (approve: boolean) => void;
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
    </div>
  );
}
