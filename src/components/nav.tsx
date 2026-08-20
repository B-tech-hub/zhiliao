"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { COMMAND_EVENTS, dispatchCommand } from "@/components/command-events";

/* 线性 SVG 图标（替代 emoji，贴近 SF Symbols 风格） */
function Icon({ name, className }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    topics: (
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    inbox: (
      <>
        <path d="M3 13h5l2 3h4l2-3h5" />
        <path d="M5 6h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.98 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.98a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
      </>
    ),
    // 收起侧栏：折叠态整体旋转 180° 复用为"展开"
    collapse: <path d="m15 6-6 6 6 6" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/", label: "主题", icon: "topics" },
  { href: "/search", label: "搜索", icon: "search" },
  { href: "/inbox", label: "未分类", icon: "inbox" },
  { href: "/settings", label: "设置", icon: "settings" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/topics") || pathname.startsWith("/notes");
  return pathname.startsWith(href);
}

/* 乐观高亮：点击瞬间按目标 href 判定激活态，路由真正切换后自动复位，
   消除服务端渲染期间"点了没反应"的感知延迟 */
function useOptimisticPath() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);
  return { activePath: pendingHref ?? pathname, setPendingHref };
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-danger px-1.5 font-mono text-micro font-semibold leading-4 text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/* 移动端底部 Tab：黑色毛玻璃（global-nav 语法：纯黑 chrome），激活态用暗面链接蓝 */
export function BottomNav({ inboxCount }: { inboxCount: number }) {
  const { activePath, setPendingHref } = useOptimisticPath();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-white/10 bg-black/85 backdrop-blur-xl md:hidden">
      <div className="flex">
        {NAV_ITEMS.map((item) => {
          const active = isActive(activePath, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              onClick={() => setPendingHref(item.href)}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] transition-colors ${
                active ? "text-sky" : "text-ink-48"
              }`}
            >
              <Icon name={item.icon} className="h-[22px] w-[22px]" />
              {item.label}
              {item.href === "/inbox" && inboxCount > 0 && (
                <span className="absolute right-[calc(50%-1.7rem)] top-0.5">
                  <CountBadge count={inboxCount} />
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

interface SideNavTopic {
  id: string;
  name: string;
  isSystem: number;
  noteCount: number;
}

const NAV_COLLAPSED_KEY = "zhiliao.navCollapsed";

/* 折叠态的事实来源是 <html data-nav-collapsed>，不是 React state——
   偏好由根 layout 的阻塞脚本在首帧前写好，宽度与显隐全部由 CSS 的 nav-collapsed
   变体承担（见 globals.css）。这里返回的 state 只是那个属性的镜像，供
   aside 的 data-collapsed 契约、开关按钮的 aria-expanded 与提示文案使用。

   写属性放在事件处理里而不是 useEffect：挂载时"读属性 → setState"与
   "state → 写属性"两个 effect 同批执行，后者会拿着尚未更新的 false 把属性抹掉，
   侧栏当场弹开一帧。 */
function useNavCollapsed() {
  const [collapsed, setCollapsed] = useState(false);

  // 水合后与阻塞脚本写下的属性对齐
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.navCollapsed === "1");
  }, []);

  useEffect(() => {
    const toggle = () => {
      const next = document.documentElement.dataset.navCollapsed !== "1";
      document.documentElement.dataset.navCollapsed = next ? "1" : "0";
      try {
        window.localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // 无痕模式下写不进去；本次会话的折叠照常生效，只是不跨刷新记住
      }
      setCollapsed(next);
    };
    window.addEventListener(COMMAND_EVENTS.toggleNav, toggle);
    return () => window.removeEventListener(COMMAND_EVENTS.toggleNav, toggle);
  }, []);

  return collapsed;
}

/* 桌面端侧栏：近黑瓷砖贴边全高（暗色 chrome），白/灰字导航，active 白字微亮底 */
export function SideNav({ topics, inboxCount }: { topics: SideNavTopic[]; inboxCount: number }) {
  const { activePath, setPendingHref } = useOptimisticPath();
  const collapsed = useNavCollapsed();
  return (
    <aside
      id="side-nav"
      /* overflow-x-hidden：宽度收拢的那 200ms 里，展开态的文字仍占着原宽度，
         不夹住会在侧栏内部闪出一条横向滚动条 */
      className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto overflow-x-hidden bg-chrome p-5 transition-[width] duration-200 motion-reduce:transition-none nav-collapsed:w-14 nav-collapsed:px-2 md:flex"
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="主导航"
    >
      <Link
        href="/"
        prefetch={true}
        aria-label="知了 · 回到首页"
        className="mb-8 block px-3 text-[21px] font-semibold tracking-[-0.374px] text-white nav-collapsed:px-0 nav-collapsed:text-center"
      >
        {/* 折叠态只剩 40px 内容宽，"知了"会被夹断，退化为单字标记 */}
        <span aria-hidden className="nav-collapsed:hidden">知了</span>
        <span aria-hidden className="hidden nav-collapsed:inline">知</span>
      </Link>
      <nav className="space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(activePath, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              onClick={() => setPendingHref(item.href)}
              title={item.label}
              className={`relative flex items-center justify-between rounded-utility px-3 py-2 text-[14px] transition-colors nav-collapsed:justify-center nav-collapsed:px-0 ${
                active
                  ? "bg-white/10 font-semibold text-white"
                  : "text-dark-muted hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="flex items-center gap-2.5 nav-collapsed:gap-0">
                <Icon name={item.icon} className="h-[17px] w-[17px]" />
                {/* 折叠态用 sr-only 而非 hidden：display:none 会把文字一并逐出无障碍树，
                    只剩图标的链接就没有可读名称了 */}
                <span className="nav-collapsed:sr-only">{item.label}</span>
              </span>
              {item.href === "/inbox" && (
                <>
                  <span className="nav-collapsed:sr-only">
                    <CountBadge count={inboxCount} />
                  </span>
                  {/* 折叠态放不下数字，退化为右上角红点：只报"有未读"，具体条数去展开态看 */}
                  {inboxCount > 0 && (
                    <span
                      aria-hidden
                      className="absolute right-1.5 top-1.5 hidden h-1.5 w-1.5 rounded-chip bg-danger nav-collapsed:block"
                    />
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>
      {/* 主题列表在折叠态整块隐去：主题名没有图标可依，缩到 40px 只会剩一堆截断的字。
          折叠时主题仍可从 ⌘K 命令面板或"主题"页进入，不是断路。 */}
      <div className="mt-9 nav-collapsed:hidden">
        <p className="px-3 pb-2 text-[12px] font-semibold text-dark-muted">全部主题</p>
        <div className="space-y-0.5">
          {topics
            .filter((t) => !t.isSystem)
            .map((t) => (
              <Link
                key={t.id}
                href={`/topics/${t.id}`}
                prefetch={true}
                onClick={() => setPendingHref(`/topics/${t.id}`)}
                className={`flex items-center justify-between rounded-utility px-3 py-1.5 text-[14px] transition-colors ${
                  activePath === `/topics/${t.id}`
                    ? "bg-white/10 font-semibold text-white"
                    : "text-dark-muted hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="truncate">{t.name}</span>
                <span className="font-mono text-micro text-dark-muted">{t.noteCount}</span>
              </Link>
            ))}
        </div>
      </div>
      {/* 折叠开关走与 ⌘\ 同一条命令事件，两条入口只有一份状态逻辑。
          光有快捷键不够：鼠标用户发现不了一个没有可见入口的功能。 */}
      <button
        type="button"
        onClick={() => dispatchCommand(COMMAND_EVENTS.toggleNav)}
        aria-controls="side-nav"
        aria-expanded={!collapsed}
        title={`${collapsed ? "展开" : "收起"}侧栏（Ctrl/⌘ + \\）`}
        className="mt-auto flex shrink-0 items-center gap-2.5 rounded-utility px-3 py-2 text-meta text-dark-muted transition-colors hover:bg-white/5 hover:text-white nav-collapsed:justify-center nav-collapsed:gap-0 nav-collapsed:px-0"
      >
        <Icon
          name="collapse"
          className="h-[17px] w-[17px] transition-transform motion-reduce:transition-none nav-collapsed:rotate-180"
        />
        <span className="nav-collapsed:sr-only">{collapsed ? "展开" : "收起"}</span>
      </button>
    </aside>
  );
}
