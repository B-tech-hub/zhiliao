"use client";

import { useEffect } from "react";
import { BodyPortal } from "@/components/body-portal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  // true 时确认键用危险红
  danger?: boolean;
  // 请求进行中：禁用按钮与关闭
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/* 确认对话框：遮罩 + 白卡，移动端底部弹出、桌面居中（Apple 弹层语法） */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "删除",
  cancelText = "取消",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <BodyPortal>
      {/* Portal 到 body：遮罩为 fixed 全屏，需避开 template 的 transform 动画劫持定位基准 */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm md:items-center"
        onClick={() => {
          if (!busy) onCancel();
        }}
      >
        <div
          className="w-full max-w-[360px] rounded-[18px] bg-surface p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[17px] font-semibold tracking-[-0.374px]">{title}</p>
          {message && <p className="mt-1.5 text-[14px] leading-[1.43] text-ink-48">{message}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="rounded-full bg-fill px-[22px] py-[8px] text-[14px] text-ink-80 transition-transform active:scale-95 disabled:opacity-40"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className={`rounded-full px-[22px] py-[8px] text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40 ${
                danger ? "bg-danger" : "bg-action"
              }`}
            >
              {busy ? "处理中…" : confirmText}
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}
