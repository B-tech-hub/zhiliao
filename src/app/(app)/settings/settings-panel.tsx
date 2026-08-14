"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatTime } from "@/components/note-card";

interface TopicRow {
  id: string;
  name: string;
  isSystem: number;
  noteCount: number;
}

type LlmSource = "db" | "env" | "none";

interface LlmInfo {
  configured: boolean;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  hasDbConfig: boolean;
  sources: { baseUrl: LlmSource; apiKey: LlmSource; model: LlmSource };
}

const SOURCE_LABEL: Record<LlmSource, string> = {
  db: "来自数据库",
  env: "来自环境变量",
  none: "未配置",
};

interface QueueInfo {
  pending: number;
  running: number;
  failed: number;
  recentFailures: { id: string; type: string; lastError: string | null; updatedAt: number }[];
}

interface VisionInfo {
  model: string;
  baseUrl: string;
  apiKeyMasked: string;
}

const THEME_OPTIONS = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
] as const;

/* 外观三态切换：iOS 分段控件形态。mounted 守卫——服务端不知道 localStorage 里的
   主题偏好，挂载前不渲染激活态，避免 hydration mismatch */
function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <section>
      <h2 className="mb-3 text-[21px] font-semibold tracking-[-0.374px]">外观</h2>
      <div className="rounded-[18px] bg-surface p-6">
        <div className="inline-flex rounded-full bg-fill p-1">
          {THEME_OPTIONS.map((o) => {
            const active = mounted && theme === o.value;
            return (
              <button
                key={o.value}
                onClick={() => setTheme(o.value)}
                aria-pressed={active}
                className={`rounded-full px-4 py-1.5 text-[14px] transition-colors ${
                  active ? "bg-surface font-semibold text-ink ring-1 ring-hairline" : "text-ink-48"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] text-ink-48">
          跟随系统会随设备深浅色自动切换，偏好保存在本机浏览器
        </p>
      </div>
    </section>
  );
}

/* 数据区块：数据信任功能的聚合入口——手动备份、导出、回收站 */
function DataSection({ lastBackupAt, trashCount }: { lastBackupAt: number | null; trashCount: number }) {
  const [backedUpAt, setBackedUpAt] = useState(lastBackupAt);
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState("");

  async function backupNow() {
    setBackingUp(true);
    setBackupResult("");
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setBackedUpAt(data.backedUpAt);
        setBackupResult("✓ 已备份");
      } else {
        setBackupResult(`✕ ${data.error || "备份失败"}`);
      }
    } catch {
      setBackupResult("✕ 网络错误");
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-[21px] font-semibold tracking-[-0.374px]">数据</h2>
      <div className="rounded-[18px] bg-surface p-6 text-[14px]">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={backupNow}
            disabled={backingUp}
            className="rounded-full bg-action px-[22px] py-[8px] text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
          >
            {backingUp ? "备份中…" : "立即备份"}
          </button>
          <span className="text-ink-48">
            最近备份：{backedUpAt ? formatTime(backedUpAt) : "从未备份"}
          </span>
          {backupResult && (
            <span className={backupResult.startsWith("✕") ? "text-danger" : "text-ink-80"}>
              {backupResult}
            </span>
          )}
        </div>
        <p className="mt-2 text-[12px] text-ink-48">
          备份数据库与图片到数据目录的 backups 文件夹；每日自动执行，各保留最近 7
          份，手动备份覆盖当天快照
        </p>
        {/* 原生 a 标签而非 next/link：Link 的 prefetch 会在 hover 时预执行导出请求 */}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-divider pt-4">
          <a
            href="/api/export"
            className="rounded-full border border-action px-[22px] py-[8px] text-[14px] text-action transition-transform active:scale-95"
          >
            导出全部数据
          </a>
          <span className="text-[12px] text-ink-48">
            Markdown + 图片打包为 zip，可导入 Obsidian 等工具
          </span>
        </div>
        <div className="mt-4 border-t border-divider pt-4">
          <Link
            href="/trash"
            prefetch={true}
            className="flex items-center justify-between text-[14px] transition-opacity active:opacity-70"
          >
            <span>回收站</span>
            <span className="text-ink-48">{trashCount > 0 ? `${trashCount} 条 ›` : "›"}</span>
          </Link>
          <p className="mt-1 text-[12px] text-ink-48">删除的笔记保留 30 天，期间可随时恢复</p>
        </div>
      </div>
    </section>
  );
}

export function SettingsPanel({
  topics,
  llm,
  vision,
  queue,
  lastBackupAt,
  trashCount,
}: {
  topics: TopicRow[];
  llm: LlmInfo;
  vision: VisionInfo;
  queue: QueueInfo;
  lastBackupAt: number | null;
  trashCount: number;
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [testing, setTesting] = useState(false);
  // 待确认删除的主题
  const [pendingDeleteTopic, setPendingDeleteTopic] = useState<TopicRow | null>(null);
  // LLM 配置表单：apiKey 初值为空，留空保存 = 不修改
  const [llmBaseUrl, setLlmBaseUrl] = useState(llm.baseUrl);
  const [llmModel, setLlmModel] = useState(llm.model);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmResult, setLlmResult] = useState("");
  const [confirmingClearLlm, setConfirmingClearLlm] = useState(false);
  // 视觉模型表单：baseUrl/apiKey 留空回落文本模型配置
  const [visionModel, setVisionModel] = useState(vision.model);
  const [visionBaseUrl, setVisionBaseUrl] = useState("");
  const [visionApiKey, setVisionApiKey] = useState("");
  const [visionSaving, setVisionSaving] = useState(false);
  const [visionResult, setVisionResult] = useState("");

  async function saveVision() {
    const body: Record<string, string> = {};
    if (visionModel.trim() !== vision.model) body.visionModel = visionModel.trim();
    if (visionBaseUrl.trim()) body.visionBaseUrl = visionBaseUrl.trim();
    if (visionApiKey.trim()) body.visionApiKey = visionApiKey.trim();
    if (Object.keys(body).length === 0) {
      setVisionResult("没有修改的内容");
      return;
    }
    setVisionSaving(true);
    setVisionResult("");
    try {
      const res = await fetch("/api/settings/llm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setVisionApiKey("");
        setVisionBaseUrl("");
        setVisionResult("✓ 已保存，立即生效");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setVisionResult(`✕ ${data.error || "保存失败"}`);
      }
    } catch {
      setVisionResult("✕ 网络错误");
    } finally {
      setVisionSaving(false);
    }
  }

  async function saveLlm() {
    const body: Record<string, string> = {};
    if (llmBaseUrl.trim() && llmBaseUrl.trim() !== llm.baseUrl) body.baseUrl = llmBaseUrl.trim();
    if (llmModel.trim() && llmModel.trim() !== llm.model) body.model = llmModel.trim();
    if (llmApiKey.trim()) body.apiKey = llmApiKey.trim();
    if (Object.keys(body).length === 0) {
      setLlmResult("没有修改的内容");
      return;
    }
    setLlmSaving(true);
    setLlmResult("");
    try {
      const res = await fetch("/api/settings/llm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setLlmApiKey("");
        setLlmResult("✓ 已保存，立即生效");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setLlmResult(`✕ ${data.error || "保存失败"}`);
      }
    } catch {
      setLlmResult("✕ 网络错误");
    } finally {
      setLlmSaving(false);
    }
  }

  async function clearLlm() {
    setLlmSaving(true);
    try {
      const res = await fetch("/api/settings/llm", { method: "DELETE" });
      if (res.ok) {
        setConfirmingClearLlm(false);
        setLlmApiKey("");
        setLlmResult("已清除数据库配置，回退到环境变量");
        router.refresh();
      }
    } finally {
      setLlmSaving(false);
    }
  }

  async function testLlm() {
    setTesting(true);
    setTestResult("");
    try {
      const res = await fetch("/api/llm/test", { method: "POST" });
      const data = await res.json();
      setTestResult(data.ok ? `✓ ${data.message}` : `✕ ${data.message}`);
    } catch {
      setTestResult("✕ 请求失败");
    } finally {
      setTesting(false);
    }
  }

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "操作失败");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("网络错误");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createTopic(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (await call("/api/topics", { method: "POST", body: JSON.stringify({ name: newName.trim() }) })) {
      setNewName("");
    }
  }

  async function renameTopic(t: TopicRow) {
    const name = prompt("新的主题名", t.name)?.trim();
    if (!name || name === t.name) return;
    await call(`/api/topics/${t.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
  }

  async function deleteTopic() {
    if (!pendingDeleteTopic) return;
    if (await call(`/api/topics/${pendingDeleteTopic.id}`, { method: "DELETE" })) {
      setPendingDeleteTopic(null);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="space-y-10">
      <section>
        <header className="mb-8">
          <p className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-ink-48">知了</p>
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.4px] md:text-[40px]">
            设置
          </h1>
        </header>
        <h2 className="mb-3 text-[21px] font-semibold tracking-[-0.374px]">主题管理</h2>
        <form onSubmit={createTopic} className="mb-3 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新主题名，如：羽毛球"
            className="h-[40px] flex-1 rounded-full border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="rounded-full bg-action px-[22px] py-[8px] text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
          >
            创建
          </button>
        </form>
        {error && <p className="mb-2 text-[14px] text-danger">{error}</p>}
        <ul className="divide-y divide-divider rounded-[18px] bg-surface">
          {topics.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-6 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold tracking-[-0.224px]">
                  {t.isSystem ? "未分类" : t.name}
                </p>
                <p className="text-[12px] text-ink-48">{t.noteCount} 条笔记</p>
              </div>
              {!t.isSystem && (
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => renameTopic(t)}
                    className="rounded-full px-3 py-1 text-[12px] text-action transition-transform active:scale-95"
                  >
                    重命名
                  </button>
                  <button
                    onClick={() => setPendingDeleteTopic(t)}
                    className="rounded-full px-3 py-1 text-[12px] text-danger transition-transform active:scale-95"
                  >
                    删除
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <AppearanceSection />

      <section>
        <h2 className="mb-3 text-[21px] font-semibold tracking-[-0.374px]">AI 服务</h2>
        <div className="space-y-4 rounded-[18px] bg-surface p-6 text-[14px]">
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span className="text-ink-48">接入点</span>
              <span className="text-[12px] text-ink-48">{SOURCE_LABEL[llm.sources.baseUrl]}</span>
            </label>
            <input
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="h-[40px] w-full rounded-full border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span className="text-ink-48">模型</span>
              <span className="text-[12px] text-ink-48">{SOURCE_LABEL[llm.sources.model]}</span>
            </label>
            <input
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder="如 gpt-4o-mini"
              className="h-[40px] w-full rounded-full border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span className="text-ink-48">API Key</span>
              <span className="text-[12px] text-ink-48">{SOURCE_LABEL[llm.sources.apiKey]}</span>
            </label>
            <input
              type="password"
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              placeholder={
                llm.sources.apiKey === "none" ? "sk-…" : `当前 ${llm.apiKeyMasked}，留空则不修改`
              }
              autoComplete="off"
              className="h-[40px] w-full rounded-full border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <p className="text-[12px] text-ink-48">
            此处保存的配置存入数据库并立即生效；未保存的项使用服务端环境变量
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={saveLlm}
              disabled={llmSaving}
              className="rounded-full bg-action px-[22px] py-[8px] text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
            >
              {llmSaving ? "保存中…" : "保存"}
            </button>
            <button
              onClick={testLlm}
              disabled={testing}
              className="rounded-full border border-action px-4 py-1.5 text-[14px] text-action transition-transform active:scale-95 disabled:opacity-40"
            >
              {testing ? "测试中…" : "测试连接"}
            </button>
            {llm.hasDbConfig && (
              <button
                onClick={() => setConfirmingClearLlm(true)}
                disabled={llmSaving}
                className="text-[12px] text-ink-48 transition-colors hover:text-danger active:scale-95"
              >
                清除数据库配置，回退环境变量
              </button>
            )}
          </div>
          {llmResult && (
            <p className={`text-[12px] ${llmResult.startsWith("✕") ? "text-danger" : "text-ink-80"}`}>
              {llmResult}
            </p>
          )}
          {testResult && (
            <p className={`text-[12px] ${testResult.startsWith("✓") ? "text-ink-80" : "text-danger"}`}>
              {testResult}
            </p>
          )}
        </div>

        <div className="mt-3 space-y-4 rounded-[18px] bg-surface p-6 text-[14px]">
          <p className="font-semibold tracking-[-0.224px]">视觉模型（AI 读图，可选）</p>
          <div>
            <label className="mb-1 block text-ink-48">模型</label>
            <input
              value={visionModel}
              onChange={(e) => setVisionModel(e.target.value)}
              placeholder="如 qwen-vl-plus / gpt-4o；留空表示不启用 AI 读图"
              className="h-[40px] w-full rounded-full border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <div>
            <label className="mb-1 block text-ink-48">接入点（留空复用上方文本模型接入点）</label>
            <input
              value={visionBaseUrl}
              onChange={(e) => setVisionBaseUrl(e.target.value)}
              placeholder={vision.baseUrl || "https://…/v1"}
              className="h-[40px] w-full rounded-full border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <div>
            <label className="mb-1 block text-ink-48">API Key（留空复用上方 API Key）</label>
            <input
              type="password"
              value={visionApiKey}
              onChange={(e) => setVisionApiKey(e.target.value)}
              placeholder={`当前 ${vision.apiKeyMasked}，留空则不修改`}
              autoComplete="off"
              className="h-[40px] w-full rounded-full border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={saveVision}
              disabled={visionSaving}
              className="rounded-full bg-action px-[22px] py-[8px] text-[14px] text-white transition-transform active:scale-95 disabled:opacity-40"
            >
              {visionSaving ? "保存中…" : "保存"}
            </button>
            {visionResult && (
              <p className={`text-[12px] ${visionResult.startsWith("✕") ? "text-danger" : "text-ink-80"}`}>
                {visionResult}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-[18px] bg-surface p-6 text-[14px]">
          <p className="mb-1 font-semibold tracking-[-0.224px]">AI 任务队列</p>
          <p className="text-ink-48">
            等待 {queue.pending} · 处理中 {queue.running} · 失败 {queue.failed}
          </p>
          {queue.recentFailures.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12px] text-danger">
              {queue.recentFailures.map((f) => (
                <li key={f.id} className="truncate">
                  [{f.type}] {f.lastError}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <DataSection lastBackupAt={lastBackupAt} trashCount={trashCount} />

      <section>
        <h2 className="mb-3 text-[21px] font-semibold tracking-[-0.374px]">账号</h2>
        <button
          onClick={logout}
          className="rounded-full bg-surface px-[22px] py-[8px] text-[14px] text-ink-80 transition-transform active:scale-95"
        >
          退出登录
        </button>
      </section>

      <ConfirmDialog
        open={pendingDeleteTopic !== null}
        title={pendingDeleteTopic ? `删除主题「${pendingDeleteTopic.name}」？` : ""}
        message={
          pendingDeleteTopic && pendingDeleteTopic.noteCount > 0
            ? `其中 ${pendingDeleteTopic.noteCount} 条笔记将移入“未分类”`
            : undefined
        }
        busy={busy}
        onConfirm={deleteTopic}
        onCancel={() => setPendingDeleteTopic(null)}
      />
      <ConfirmDialog
        open={confirmingClearLlm}
        title="清除数据库中的 LLM 配置？"
        message="清除后将回退到服务端环境变量的配置"
        confirmText="清除"
        busy={llmSaving}
        onConfirm={clearLlm}
        onCancel={() => setConfirmingClearLlm(false)}
      />
    </div>
  );
}
