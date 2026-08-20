import Link from "next/link";
import { getTopicsWithCounts } from "@/lib/topics";
import { getToolSupport, isReasoningConfigured, isVisionConfigured } from "@/lib/llm-config";
import { BottomNav, SideNav } from "@/components/nav";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatScopeProvider } from "@/components/chat/chat-scope";
import { CommandPalette } from "@/components/command-palette";
import { GlobalShortcuts } from "@/components/global-shortcuts";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const topicRows = getTopicsWithCounts();
  const inboxCount = topicRows.find((t) => t.isSystem)?.noteCount ?? 0;

  return (
    <ChatScopeProvider>
      <div className="flex min-h-dvh">
        <GlobalShortcuts />
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

        {/* 快速记录：主行动使用 CTA 墨底，按下 scale 0.95。
            --chat-rail 由 ChatPanel 在打开时写到 <html>：桌面端面板是推挤布局的第三栏，
            这颗 fixed 钮不让位就会浮在面板上压住输入区。手机端面板全屏，钮本就看不见，
            故只有 md 以上读它。 */}
        <Link
          href="/notes/new"
          prefetch={true}
          aria-label="快速记录"
          className="fixed bottom-20 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-cta text-cta-ink transition-transform active:scale-95 md:bottom-10 md:right-[calc(2.5rem+var(--chat-rail,0px))]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-6 w-6" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>

        {/* AI 助手：全局唯一一份，当前页面的笔记/主题由 ChatScopeBinder 登记为上下文附件。
            桌面端它是这一行 flex 的第三栏（打开时把正文推窄，而不是盖住），手机端仍是全屏浮层。
            必须排在 <main> 之后：flex 顺序决定它靠右。 */}
        <ChatPanel
          visionAvailable={isVisionConfigured()}
          reasoningAvailable={isReasoningConfigured()}
          toolSupport={getToolSupport()}
        />
        <CommandPalette topics={topicRows.filter((topic) => !topic.isSystem).map(({ id, name }) => ({ id, name }))} />
      </div>
    </ChatScopeProvider>
  );
}
