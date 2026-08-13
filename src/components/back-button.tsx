"use client";

import { useRouter } from "next/navigation";

/* iOS 风返回按钮：chevron + 文字，Action Blue。优先浏览器后退；
   无历史可退（直达链接 / PWA 冷启动深链）时跳转兜底路径 */
export function BackButton({
  fallback = "/",
  label = "返回",
  iconOnly = false,
  className = "",
}: {
  fallback?: string;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const router = useRouter();

  function goBack() {
    // Navigation API 的 canGoBack 只统计同源可退条目，能正确识别
    // "新标签页直开"（history 里有 about:blank，length>1 但实际无处可退）；
    // 不支持的浏览器降级为 history.length 启发式
    const nav = (window as { navigation?: { canGoBack?: boolean } }).navigation;
    const canGoBack = nav?.canGoBack !== undefined ? nav.canGoBack : window.history.length > 1;
    if (canGoBack) router.back();
    else router.replace(fallback);
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={label}
      className={`flex shrink-0 items-center gap-0.5 text-[14px] text-action transition-transform active:scale-95 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden
      >
        <path d="m15 6-6 6 6 6" />
      </svg>
      {!iconOnly && label}
    </button>
  );
}
