"use client";

import { useEffect } from "react";
import { dispatchCommand, isEditableTarget } from "@/components/command-events";

/* 全局快捷键只负责分发跨组件动作；编辑器和助手输入框保留自己的按键语义。 */
export function GlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.metaKey || event.ctrlKey;
      if (!commandKey) return;
      if (event.key.toLowerCase() === "k") return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        dispatchCommand("zhiliao:command-force-save");
        return;
      }
      if (event.key === "Enter" && isEditableTarget(event.target)) {
        event.preventDefault();
        dispatchCommand("zhiliao:command-submit-chat");
        return;
      }
      if (isEditableTarget(event.target)) {
        // 编辑器的 slash menu 通过 ProseMirror handleKeyDown 消费按键。
        return;
      }
      if (event.key === "\\") {
        event.preventDefault();
        dispatchCommand("zhiliao:command-toggle-nav");
      } else if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        dispatchCommand("zhiliao:command-toggle-chat");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}
