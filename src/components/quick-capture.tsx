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
export function QuickCapture({ topics, handwritingEnabled }: { topics: TopicOption[]; handwritingEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  // 草稿托管在这里而不是表单里：表单随浮层开合挂载卸载，存在里面关一次就没了
  const [draft, setDraft] = useState("");
  const { scope } = useChatScope();
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

  /* Esc 挂 window 的**捕获阶段**，且只在浮层打开时注册。
     不挂 window 冒泡：助手面板的监听在那儿，一起挂会一次 Esc 关掉两层。
     也不挂浮层节点：那样等于要求焦点必须停在浮层内，焦点一跑到 body 上就失灵。

     让路判据不能靠 stopPropagation：它只挡事件传向后续节点，挡不住同一节点上
     的其他监听器——命令面板的监听也在 window 捕获阶段，两条必然都会执行。
     所以改为显式让路：还有别的 role="dialog" 开着（命令面板 z-50、确认弹窗），
     说明上面压着一层，Esc 归它消费。本浮层自己那个也算在内，故判据是 > 1。 */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      // 到这里说明本浮层就是最上层：拦下事件，别让助手面板也跟着关
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
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
        /* 点遮罩关闭。草稿留在本组件里，关掉再打开原样还在，这一下什么都不会丢；
           反过来，遮罩不可点会把全屏浮层变成没有出口的陷阱——用户会以为页面卡死了。
           关闭动作必须挂在遮罩上、并由浮层 stopPropagation 挡住，不能用
           preventDefault 去拦：那会连正文、下拉、按钮的 mousedown 一起吞掉，
           下拉打不开、光标挪不动。这套写法与命令面板一致。
           遮罩取 /40 而非命令面板的 /25：那份是搜索框，底下衬什么都无所谓；
           这份底下衬的是深色页面，/25 叠上去几乎分不出层。 */
        <div
          className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/40 md:items-start md:px-4 md:pt-[12vh]"
          onMouseDown={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="快速记录"
            /* 高度刻意压得比整页矮一大截：这里是「记一条就走」，
               开半屏编辑器只会让人对着一片空白发呆。写长了照样能滚。 */
            className="flex w-full flex-col overflow-hidden bg-surface md:h-[min(52vh,22rem)] md:max-w-2xl md:rounded-card md:border md:border-hairline md:shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <NewNoteForm
              topics={topics}
              defaultTopicId={scopedTopicId}
              onClose={close}
              draft={draft}
              onDraftChange={setDraft}
              handwritingEnabled={handwritingEnabled}
            />
          </div>
        </div>
      )}
    </>
  );
}
