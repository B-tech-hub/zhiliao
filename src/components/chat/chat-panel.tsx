"use client";

// AI 对话侧边栏面板：围绕当前笔记/主题，流式回答，历史持久化

import { useEffect, useRef, useState } from "react";
import { BodyPortal } from "@/components/body-portal";
import { useChat } from "./use-chat";

export function ChatPanel({
  scopeType,
  scopeId,
  contextTitle,
  hasImages,
  visionAvailable,
}: {
  scopeType: "note" | "topic";
  scopeId: string;
  contextTitle: string;
  // 当前笔记是否含图片（决定是否展示“让 AI 看图”开关）
  hasImages?: boolean;
  visionAvailable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [useVision, setUseVision] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const chat = useChat(scopeType, scopeId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.msgs]);

  const submit = () => {
    if (!input.trim() || chat.streaming) return;
    void chat.send(input, useVision);
    setInput("");
  };

  return (
    <BodyPortal>
      {/* 唤起按钮：与右下角"快速记录"钮横向并排贴底（Portal 到 body，避开 template 的 transform 动画劫持 fixed 定位） */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-[5.5rem] z-20 flex h-12 w-12 items-center justify-center rounded-full bg-chrome text-white shadow-lg transition-transform active:scale-95 dark:ring-1 dark:ring-white/15 md:bottom-10 md:right-[6.75rem]"
        aria-label="AI 对话"
        title="AI 对话"
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
              <div className="min-w-0">
                <p className="text-[14px] font-semibold tracking-[-0.224px]">AI 对话</p>
                <p className="truncate text-[12px] text-ink-48">
                  围绕{scopeType === "note" ? "笔记" : "主题"}：{contextTitle}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="rounded-full px-2.5 py-1 text-[12px] text-ink-48 hover:bg-fill"
                >
                  历史
                </button>
                <button
                  onClick={() => chat.openConversation(null)}
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
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => {
                          void chat.openConversation(c.id);
                          setShowHistory(false);
                        }}
                      >
                        {c.title || "（无标题）"}
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
              {chat.msgs.length === 0 && (
                <p className="pt-8 text-center text-[13px] text-ink-48">
                  问点关于这{scopeType === "note" ? "篇笔记" : "个主题"}的问题吧
                </p>
              )}
              {chat.msgs.map((m, i) =>
                // 工具执行的提示行：不属于对话本身，弱化成居中小字
                m.role === "notice" ? (
                  <p key={i} className="text-center text-[12px] leading-[1.5] text-ink-48">
                    {m.content}
                  </p>
                ) : (
                  <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-[14px] px-3.5 py-2 text-[14px] leading-[1.5] ${
                        m.role === "user" ? "bg-action text-white" : "bg-fill text-ink-80"
                      }`}
                    >
                      {m.content || (chat.streaming ? "…" : "")}
                    </div>
                  </div>
                ),
              )}
              {chat.error && <p className="text-[12px] text-danger">{chat.error}</p>}
              <div ref={bottomRef} />
            </div>

            {/* 输入区 */}
            <div className="border-t border-divider p-4">
              {hasImages && (
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
                    className="h-9 shrink-0 rounded-full border border-hairline px-4 text-[13px] text-ink-48 active:scale-95"
                  >
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
