"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect } from "react";

/* 三态主题（浅色/深色/跟随系统）：class 策略写到 <html>，偏好存 localStorage("theme")，
   首屏防闪烁由 next-themes 注入的阻塞内联脚本保证（技术选型见 docs/adr/0005） */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
      <ThemeColorSync />
    </NextThemesProvider>
  );
}

/* PWA 状态栏颜色随主题联动。
   注意：theme-color meta 必须完全由本组件自建自管（挂 data 标记、只改属性不删节点）——
   绝不能动 React 管理的 head 节点（如 viewport.themeColor 的产物），
   否则路由切换时 React 清理已被删除的节点会抛 removeChild 异常并中断渲染 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!resolvedTheme) return;
    // theme-color 由浏览器读取，不能引用 CSS 变量；设计门禁只精确豁免这一行。
    const color = resolvedTheme === "dark" ? "#000000" : "#f5f5f7";
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"][data-theme-sync]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.setAttribute("data-theme-sync", "");
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, [resolvedTheme]);
  return null;
}
