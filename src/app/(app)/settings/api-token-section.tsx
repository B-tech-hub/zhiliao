"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export interface ApiTokenInfo {
  id: string;
  scope: string;
  prefix: string;
  last4: string;
  createdAt: number;
  lastUsedAt: number | null;
}

type Notice = { kind: "success" | "error"; text: string } | null;

const SCOPE_LABELS: Record<string, string> = {
  "capture:write": "手机快捷记录",
  "knowledge:read": "知识读取",
};

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand("copy")) {
      throw new Error("copy failed");
    }
  } finally {
    textarea.remove();
  }
}

function messageFromStatus(status: number, fallback: string) {
  if (status === 401) return "Token 无效或已吊销。输入内容仍保留，请重新创建手机快捷记录 Token。";
  if (status === 400) return "写入内容不符合接口要求。输入内容仍保留，请检查后重试。";
  return `${fallback || "写入失败"}。输入内容仍保留，请稍后重试。`;
}

export function ApiTokenSection({ initial }: { initial: ApiTokenInfo[] }) {
  const [tokens, setTokens] = useState(initial);
  const [scope, setScope] = useState("capture:write");
  const [newToken, setNewToken] = useState("");
  const [newTokenId, setNewTokenId] = useState("");
  const [newTokenScope, setNewTokenScope] = useState("");
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  const [captureText, setCaptureText] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<Notice>(null);
  const [createdNoteId, setCreatedNoteId] = useState("");
  const [revokeBusy, setRevokeBusy] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const captureUrl = `${origin}/api/external/capture`;
  const shortcutConfig = [
    `URL: ${captureUrl}`,
    "方法: POST",
    `Authorization: Bearer ${newToken}`,
    "Content-Type: application/json",
    '请求体: {"content":"快捷指令输入"}',
  ].join("\n");

  async function create() {
    setBusy(true);
    setNewToken("");
    setNewTokenId("");
    setNewTokenScope("");
    setCopyFallback("");
    setNotice(null);
    setCaptureNotice(null);
    setCreatedNoteId("");
    try {
      const response = await fetch("/api/settings/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = await response.json();
      if (!response.ok) {
        setNotice({ kind: "error", text: data.error || "Token 创建失败，请稍后重试。" });
        return;
      }
      setNewToken(data.token);
      setNewTokenId(data.tokenInfo.id);
      setNewTokenScope(scope);
      setTokens((value) => [...value, data.tokenInfo]);
      setNotice({ kind: "success", text: "Token 已创建。明文关闭页面后无法找回，请立即完成手机配置。" });
    } catch {
      setNotice({ kind: "error", text: "Token 创建失败，请检查网络后重试。" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (revokeBusy) return;
    setRevokeBusy(id);
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        setNotice({ kind: "error", text: data.error || "Token 吊销失败，请稍后重试。" });
        return;
      }
      setTokens((value) => value.filter((token) => token.id !== id));
      if (id === newTokenId) {
        setNewToken("");
        setNewTokenId("");
        setNewTokenScope("");
        setCopyFallback("");
      }
      setNotice({ kind: "success", text: id === newTokenId ? "Token 已吊销，使用它的手机快捷指令会立即失效；草稿已保留，重新创建 Token 后可继续自测。" : "Token 已吊销，使用它的手机快捷指令会立即失效。" });
    } catch {
      setNotice({ kind: "error", text: "Token 吊销失败，请检查网络后重试。" });
    } finally {
      setRevokeBusy(null);
    }
  }

  async function copy(label: string, value: string) {
    try {
      await copyText(value);
      setCopied(label);
      setCopyFallback("");
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopyFallback(value);
      setNotice({ kind: "error", text: "复制失败，请手动选中文本。" });
    }
  }

  async function verifyCapture() {
    if (!captureText.trim() || !newToken) return;
    setCaptureBusy(true);
    setCaptureNotice(null);
    setCreatedNoteId("");
    try {
      const response = await fetch("/api/external/capture", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${newToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: captureText.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setCaptureNotice({ kind: "error", text: messageFromStatus(response.status, data.error) });
        return;
      }
       if (typeof data.id !== "string" || !data.id) {
         setCaptureNotice({ kind: "error", text: "服务端返回了无效笔记编号。输入内容仍保留，请稍后重试。" });
         return;
       }
       setCreatedNoteId(data.id);
      setCaptureText("");
      setCaptureNotice({ kind: "success", text: "写入成功，笔记已进入 AI 整理队列。" });
    } catch {
      setCaptureNotice({ kind: "error", text: "写入失败，内容仍保留在输入框，请检查网络后重试。" });
    } finally {
      setCaptureBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-title font-semibold tracking-normal">外部接入</h2>
      <div className="rounded-card bg-surface p-4 text-ui md:p-6">
        <p className="text-meta leading-5 text-ink-48">
          Token 默认不存在。按用途单独创建，明文只显示一次，丢失后只能吊销并重建。
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor="api-token-scope" className="mb-2 block text-meta text-ink-80">用途</label>
            <select
              id="api-token-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              className="h-11 w-full rounded-utility border border-hairline bg-surface px-3 outline-none focus-visible:border-action-focus"
            >
              <option value="capture:write">手机快捷记录（只写入）</option>
              <option value="knowledge:read">知识读取（搜索、MCP）</option>
            </select>
          </div>
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="h-11 rounded-utility bg-cta px-5 text-cta-ink transition-transform active:scale-95 disabled:opacity-40"
          >
            {busy ? "创建中..." : "创建 Token"}
          </button>
        </div>

        {notice && (
          <p
            role="status"
            className={`mt-3 text-meta leading-5 ${notice.kind === "error" ? "text-danger" : "text-ink-80"}`}
          >
            {notice.text}
          </p>
        )}

        {newToken && (
          <div className="mt-5 border-t border-divider pt-5">
            <h3 className="text-ui font-semibold tracking-normal">刚创建的 Token</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <code className="min-w-0 break-all rounded-utility bg-fill px-3 py-2 font-mono text-meta leading-5">
                {newToken}
              </code>
              <button
                type="button"
                onClick={() => copy("token", newToken)}
                className="min-h-11 rounded-utility border border-hairline px-4 text-ink-80 transition-transform active:scale-95"
              >
                {copied === "token" ? "已复制" : "复制 Token"}
              </button>
            </div>
          </div>
        )}

        {copyFallback && (
          <div className="mt-4">
            <label htmlFor="copy-fallback" className="mb-2 block text-meta text-ink-80">复制失败，请手动选中文本</label>
            <textarea
              id="copy-fallback"
              readOnly
              value={copyFallback}
              rows={5}
              className="w-full resize-y rounded-utility border border-hairline bg-fill px-3 py-2 font-mono text-meta leading-5 outline-none focus-visible:border-action-focus"
            />
          </div>
        )}

        {newToken && newTokenScope === "capture:write" && (
          <div className="mt-5 border-t border-divider pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-ui font-semibold tracking-normal">手机快捷记录</h3>
                <p className="mt-1 text-meta leading-5 text-ink-48">先在这里验证写入，再配置 iOS 快捷指令。</p>
              </div>
              <Link
                href="/mobile-capture-guide.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-meta text-action underline decoration-action/30 underline-offset-4"
              >
                打开配置指南
              </Link>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <label htmlFor="capture-endpoint" className="mb-2 block text-meta text-ink-80">捕获接口</label>
                <input
                  id="capture-endpoint"
                  value={captureUrl}
                  readOnly
                  className="h-11 w-full rounded-utility border border-hairline bg-fill px-3 font-mono text-meta outline-none focus-visible:border-action-focus"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 lg:flex">
                <button
                  type="button"
                  onClick={() => copy("url", captureUrl)}
                  className="min-h-11 rounded-utility border border-hairline px-4 text-ink-80 transition-transform active:scale-95"
                >
                  {copied === "url" ? "已复制" : "复制地址"}
                </button>
                <button
                  type="button"
                  onClick={() => copy("config", shortcutConfig)}
                  className="min-h-11 rounded-utility border border-hairline px-4 text-ink-80 transition-transform active:scale-95"
                >
                  {copied === "config" ? "已复制" : "复制请求信息"}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="capture-test-content" className="mb-2 block text-meta text-ink-80">写入一条真实笔记</label>
              <textarea
                id="capture-test-content"
                value={captureText}
                onChange={(event) => setCaptureText(event.target.value)}
                rows={3}
                className="w-full resize-y rounded-utility border border-hairline bg-surface px-3 py-2 outline-none focus-visible:border-action-focus"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={verifyCapture}
                  disabled={captureBusy || !captureText.trim()}
                  className="min-h-11 rounded-utility bg-cta px-5 text-cta-ink transition-transform active:scale-95 disabled:opacity-40"
                >
                  {captureBusy ? "写入中..." : "写入知识库"}
                </button>
                {createdNoteId && (
                  <Link href={`/notes/${createdNoteId}`} className="text-meta text-action underline decoration-action/30 underline-offset-4">
                    打开这条笔记
                  </Link>
                )}
              </div>
              {captureNotice && (
                <p
                  role="status"
                  className={`mt-3 text-meta leading-5 ${captureNotice.kind === "error" ? "text-danger" : "text-ink-80"}`}
                >
                  {captureNotice.text}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 border-t border-divider pt-5">
          <h3 className="text-ui font-semibold tracking-normal">现有 Token</h3>
          {tokens.length === 0 ? (
            <p className="mt-2 text-meta text-ink-48">还没有 Token。</p>
          ) : (
            <div className="mt-2">
              {tokens.map((token) => (
                <div key={token.id} className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-t border-divider py-2 first:border-t-0">
                  <span className="min-w-0 text-meta text-ink-80">
                    {SCOPE_LABELS[token.scope] || token.scope} <span className="font-mono text-ink-48">{token.prefix}...{token.last4}</span>
                  </span>
                  <button
                    type="button"
                     onClick={() => revoke(token.id)}
                     disabled={revokeBusy !== null}
                     className="min-h-11 px-2 text-meta text-danger disabled:opacity-40"
                  >
                    吊销
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
