"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/* 将 fixed 定位内容传送到 document.body：
   页面内容被 template 的 transform 动画包裹（animate-page-in, fill-mode: both），
   transform 祖先会劫持 fixed 元素的定位基准（containing block），
   导致悬浮按钮/全屏遮罩相对内容卡片而非视口定位。挂到 body 彻底规避。
   SSR 无 document，挂载后再渲染（首帧延迟一帧，避免 hydration 不一致）。 */
export function BodyPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
