"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChatScope } from "@/components/chat/chat-scope";
import { COMMAND_EVENTS } from "@/components/command-events";
import { NewNoteForm } from "@/components/new-note-form";

interface TopicOption {
  id: string;
  name: string;
  isSystem: number;
}

/* 快速记录钮的样式，桌面端的 <button> 与移动端的 <Link> 共用一份。
   提成常量还有一层用意：设计门禁对整圆类按整行精确匹配豁免（连注释行也照查），
   两处各写一遍就要豁免两行，改一行忘一行门禁直接红。
   display 不在这里给，由两个使用点各自决定谁在什么断点出现。

   --chat-rail 由 ChatPanel 在打开时写到 <html>：桌面端面板是推挤布局的第三栏，
   这颗 fixed 钮不让位就会浮在面板上压住输入区。手机端面板全屏，钮本就看不见，
   故只有 md 以上读它。 */
const FAB_CLASS =
  "fixed bottom-20 right-5 z-20 h-14 w-14 items-center justify-center " +
  "rounded-full bg-cta text-cta-ink transition-transform active:scale-95 " +
  "md:bottom-10 md:right-[calc(2.5rem+var(--chat-rail,0px))]";

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-6 w-6" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/* 快速捕获：桌面端就地开浮层，手机端仍旧整页跳 /notes/new——
   小屏上浮层挤在软键盘与浏览器 chrome 之间，比整页更差。
   两个入口用 CSS 断点分流而不是 JS 媒体查询：首帧就是对的，也不会有水合抖动。

   这里不需要 BodyPortal：本组件挂在 (app)/layout.tsx 里，是 <main> 的兄弟，
   而劫持 fixed 定位的 transform 动画在 template.tsx 上、只包 <main> 的内容。
   判据是渲染位置，别照搬 CommandPalette——那一份渲染在页面内容里。 */
export function QuickCapture({ topics }: { topics: TopicOption[] }) {
  const [open, setOpen] = useState(false);
  // 草稿托管在这里而不是表单里：表单随浮层开合挂载卸载，存在里面误触一次就没了
  const [draft, setDraft] = useState("");
  const { scope } = useChatScope();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  /* 停在某个主题页时预选该主题，省掉一次下拉。系统主题（收件箱）不在下拉选项里，
     预选了会让 <select> 显示空白，故一并排除。 */
  const scopedTopicId =
    scope?.type === "topic" && topics.some((t) => t.id === scope.id && !t.isSystem)
      ? scope.id
      : undefined;

  const openOverlay = useCallback(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // 从命令面板唤起时，记下的那个节点可能已随面板卸载，聚焦它没有意义
    const target = restoreRef.current;
    restoreRef.current = null;
    if (target?.isConnected) target.focus();
  }, []);

  // ⌘K 面板的「新建笔记」走同一条路径，两个入口行为一致
  useEffect(() => {
    window.addEventListener(COMMAND_EVENTS.quickCapture, openOverlay);
    return () => window.removeEventListener(COMMAND_EVENTS.quickCapture, openOverlay);
  }, [openOverlay]);

  /* Esc 的监听器挂在浮层节点上，不挂 window：挂 window 时助手面板也开着的话，
     一次 Esc 会把两层一起关掉——它自己的监听器同样在 window 上。
     stopPropagation 让事件到不了 window，分层退出才成立。
     命令面板的监听在 window 捕获阶段、先于这里，但它在关闭时对 Esc 直接 return。 */
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return (
    <>
      {/* 手机端：整页形态，保持 prefetch */}
      <Link href="/notes/new" prefetch={true} aria-label="快速记录" className={`${FAB_CLASS} flex md:hidden`}>
        <PlusIcon />
      </Link>
      {/* 桌面端：就地浮层 */}
      <button type="button" onClick={openOverlay} aria-label="快速记录" className={`${FAB_CLASS} hidden md:flex`}>
        <PlusIcon />
      </button>

      {open && (
        /* 点遮罩不关闭：浮层里躺着还没保存的字，误触一次就白敲了。
           preventDefault 是为了让焦点留在正文——焦点飘到 body 上，
           Esc 就走不到上面那个挂在浮层节点上的监听器。
           遮罩取 /40 而非命令面板的 /25：那份是搜索框，底下衬什么都无所谓；
           这份底下衬的是深色页面，/25 叠上去几乎分不出层。 */
        <div
          className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/40 md:items-start md:px-4 md:pt-[12vh]"
          onMouseDown={(event) => event.preventDefault()}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="快速记录"
            /* 高度刻意压得比整页矮一大截：这里是「记一条就走」，
               开半屏编辑器只会让人对着一片空白发呆。写长了照样能滚。 */
            className="flex w-full flex-col overflow-hidden bg-surface md:h-[min(52vh,22rem)] md:max-w-2xl md:rounded-card md:border md:border-hairline md:shadow-2xl"
          >
            <NewNoteForm
              topics={topics}
              defaultTopicId={scopedTopicId}
              onClose={close}
              draft={draft}
              onDraftChange={setDraft}
            />
          </div>
        </div>
      )}
    </>
  );
}
