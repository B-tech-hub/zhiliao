"use client";

import { useEffect } from "react";

/* 注册离线兜底 Service Worker：仅生产环境启用（开发时会缓存干扰 HMR 与调试）。
   SW 本体见 public/sw.js，策略为 network-only + 导航失败回离线页 */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 注册失败（如非安全上下文）不影响正常使用，静默降级
    });
  }, []);
  return null;
}
