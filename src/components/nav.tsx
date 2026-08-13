"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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
    <span className="rounded-full bg-danger px-1.5 text-[11px] font-semibold leading-4 text-white">
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

/* 桌面端侧栏：近黑瓷砖贴边全高（暗色 chrome），白/灰字导航，active 白字微亮底 */
export function SideNav({ topics, inboxCount }: { topics: SideNavTopic[]; inboxCount: number }) {
  const { activePath, setPendingHref } = useOptimisticPath();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto bg-chrome p-5 md:flex">
      <Link
        href="/"
        prefetch={true}
        className="mb-8 block px-3 text-[21px] font-semibold tracking-[-0.374px] text-white"
      >
        知了
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
              className={`flex items-center justify-between rounded-[8px] px-3 py-2 text-[14px] transition-colors ${
                active
                  ? "bg-white/10 font-semibold text-white"
                  : "text-dark-muted hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon name={item.icon} className="h-[17px] w-[17px]" />
                {item.label}
              </span>
              {item.href === "/inbox" && <CountBadge count={inboxCount} />}
            </Link>
          );
        })}
      </nav>
      <div className="mt-9">
        <p className="px-3 pb-2 text-[12px] font-semibold text-ink-48">全部主题</p>
        <div className="space-y-0.5">
          {topics
            .filter((t) => !t.isSystem)
            .map((t) => (
              <Link
                key={t.id}
                href={`/topics/${t.id}`}
                prefetch={true}
                onClick={() => setPendingHref(`/topics/${t.id}`)}
                className={`flex items-center justify-between rounded-[8px] px-3 py-1.5 text-[14px] transition-colors ${
                  activePath === `/topics/${t.id}`
                    ? "bg-white/10 font-semibold text-white"
                    : "text-dark-muted hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="truncate">{t.name}</span>
                <span className="text-[12px] text-ink-48">{t.noteCount}</span>
              </Link>
            ))}
        </div>
      </div>
    </aside>
  );
}
