import Link from "next/link";
import { getTopicsWithCounts } from "@/lib/topics";
import { getToolSupport, isReasoningConfigured, isVisionConfigured } from "@/lib/llm-config";
import { BottomNav, SideNav } from "@/components/nav";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatScopeProvider } from "@/components/chat/chat-scope";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const topicRows = getTopicsWithCounts();
  const inboxCount = topicRows.find((t) => t.isSystem)?.noteCount ?? 0;

  return (
    <ChatScopeProvider>
      <div className="flex min-h-dvh">
        {/* 桌面端左侧暗色侧栏（贴边全高） */}
        <SideNav topics={topicRows} inboxCount={inboxCount} />

        {/* 内容区（羊皮纸画布），自身居中限宽 */}
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[980px] px-5 pb-28 pt-8 md:px-12 md:pb-16 md:pt-14">
            {children}
          </div>
        </main>

        {/* 移动端底部 Tab */}
        <BottomNav inboxCount={inboxCount} />

        {/* 快速记录：Action Blue 圆形按钮，按下 scale 0.95 */}
        <Link
          href="/notes/new"
          prefetch={true}
          aria-label="快速记录"
          className="fixed bottom-20 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-action text-white transition-transform active:scale-95 md:bottom-10 md:right-10"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-6 w-6" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>

        {/* AI 助手：全局唯一一份，当前页面的笔记/主题由 ChatScopeBinder 登记为上下文附件 */}
        <ChatPanel
          visionAvailable={isVisionConfigured()}
          reasoningAvailable={isReasoningConfigured()}
          toolSupport={getToolSupport()}
        />
      </div>
    </ChatScopeProvider>
  );
}
