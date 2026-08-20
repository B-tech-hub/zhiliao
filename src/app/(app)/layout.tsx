import { getTopicsWithCounts } from "@/lib/topics";
import { getToolSupport, isReasoningConfigured, isVisionConfigured } from "@/lib/llm-config";
import { BottomNav, SideNav } from "@/components/nav";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatScopeProvider } from "@/components/chat/chat-scope";
import { CommandPalette } from "@/components/command-palette";
import { GlobalShortcuts } from "@/components/global-shortcuts";
import { QuickCapture } from "@/components/quick-capture";

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

        {/* 快速记录：桌面端就地开浮层，手机端仍是整页 /notes/new。
            主题列表直接从上面那次查询传下去——浮层与整页共用同一份表单，
            但整页那条路会自己再查一次（它是独立路由，进不来这个作用域）。 */}
        <QuickCapture
          topics={topicRows.map(({ id, name, isSystem }) => ({ id, name, isSystem }))}
        />

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
