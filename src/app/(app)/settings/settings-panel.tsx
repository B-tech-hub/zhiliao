"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
// 视觉配置多一态：未显式填写时回落文本模型配置
type VisionSource = LlmSource | "fallback";

/* 数据库值遮蔽了不同的环境变量值。必须显示出来：改了 .env.local 却不生效
   是完全静默的，实测中曾因此把按 4B 算好的向量全部按 8B 重算一次 */
interface ConfigShadow {
  baseUrl: string | null;
  model: string | null;
  apiKey: boolean;
}

interface LlmInfo {
  configured: boolean;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  hasDbConfig: boolean;
  sources: { baseUrl: LlmSource; apiKey: LlmSource; model: LlmSource };
  shadowed: ConfigShadow;
}

const SOURCE_LABEL: Record<LlmSource, string> = {
  db: "来自数据库",
  env: "来自环境变量",
  none: "未配置",
};

const VISION_SOURCE_LABEL: Record<VisionSource, string> = {
  ...SOURCE_LABEL,
  fallback: "回落文本模型",
};

/* 环境变量被数据库配置盖住时的提示。只在两者**不同**时出现——相同则无歧义，
   提示反而是噪声。密钥不显示原值，只说存在分歧。 */
function ShadowNotice({ shadowed }: { shadowed: ConfigShadow | undefined }) {
  if (!shadowed) return null;
  const items = [
    shadowed.model ? `模型名（环境变量里是 ${shadowed.model}）` : null,
    shadowed.baseUrl ? `接入点（环境变量里是 ${shadowed.baseUrl}）` : null,
    shadowed.apiKey ? "API Key" : null,
  ].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <p className="mt-2 text-[12px] leading-[1.5] text-danger">
      以下项的环境变量已被数据库配置覆盖、不生效：{items.join("；")}。改 .env 不会有效果，请在此处修改，或清除数据库配置以回退。
    </p>
  );
}

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
  sources: { baseUrl: VisionSource; apiKey: VisionSource; model: VisionSource };
  shadowed: ConfigShadow;
}
type ReasoningInfo = VisionInfo;
type EmbeddingInfo = {
  model: string;
  baseUrl: string;
  apiKeyMasked: string;
  sources: { baseUrl: LlmSource; apiKey: LlmSource; model: LlmSource };
  shadowed: ConfigShadow;
};

interface ReviewInfo {
  enabled: boolean;
  // 已安排生成的周（上周一日期 YYYY-MM-DD），从未生成为 null
  lastWeek: string | null;
}

interface ApiTokenInfo { id: string; scope: string; prefix: string; last4: string; createdAt: number; lastUsedAt: number | null }
interface CorrectionInfo { enabled: boolean; count: number }

function ApiTokenSection({ initial }: { initial: ApiTokenInfo[] }) {
  const [tokens, setTokens] = useState(initial);
  const [scope, setScope] = useState("capture:write");
  const [newToken, setNewToken] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true); setNewToken("");
    try { const r = await fetch("/api/settings/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) }); const d = await r.json(); if (r.ok) { setNewToken(d.token); setTokens((v) => [...v, d.tokenInfo]); } } finally { setBusy(false); }
  }
  async function revoke(id: string) { await fetch(`/api/settings/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" }); setTokens((v) => v.filter((t) => t.id !== id)); }
  return <section><h2 className="mb-3 text-[21px] font-semibold tracking-[-0.374px]">外部接入</h2><div className="rounded-card bg-surface p-6 text-[14px]"><p className="text-ink-48">Token 默认不存在。创建后明文只显示一次。</p><div className="mt-3 flex flex-wrap gap-3"><select value={scope} onChange={(e) => setScope(e.target.value)} className="h-[40px] rounded-utility border border-hairline bg-surface px-3"><option value="capture:write">快速捕获（写入）</option><option value="knowledge:read">知识读取（搜索、MCP）</option></select><button onClick={create} disabled={busy} className="rounded-utility bg-cta px-[22px] py-[8px] text-cta-ink">{busy ? "生成中…" : "创建 Token"}</button></div>{newToken && <p className="mt-3 break-all rounded-utility bg-fill p-3 font-mono text-[12px]">{newToken}</p>}<div className="mt-4 space-y-2">{tokens.map((t) => <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-2"><span>{t.scope} · {t.prefix}••••{t.last4}</span><button onClick={() => revoke(t.id)} className="text-danger">吊销</button></div>)}</div></div></section>;
}

function CorrectionSection({ initial }: { initial: CorrectionInfo }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [count, setCount] = useState(initial.count);
  async function toggle(next: boolean) { await fetch("/api/settings/corrections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) }); setEnabled(next); }
  async function clear() { await fetch("/api/settings/corrections", { method: "DELETE" }); setCount(0); }
  return <section><h2 className="mb-3 text-[21px] font-semibold tracking-[-0.374px]">纠正即学习</h2><div className="rounded-card bg-surface p-6 text-[14px]"><p className="text-ink-48">记录你手动修改的主题、标题和标签，用作后续整理的少量参考样例。</p><div className="mt-3 flex flex-wrap items-center gap-3"><button onClick={() => toggle(!enabled)} className="rounded-utility border border-hairline px-4 py-1.5">{enabled ? "已开启" : "已关闭"}</button><span className="text-ink-48">已有 {count} 条样例</span><button onClick={clear} className="text-danger">清空样例</button></div></div></section>;
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
      <div className="rounded-card bg-surface p-6">
        <div className="inline-flex rounded-utility bg-fill p-1">
          {THEME_OPTIONS.map((o) => {
            const active = mounted && theme === o.value;
            return (
              <button
                key={o.value}
                onClick={() => setTheme(o.value)}
                aria-pressed={active}
                className={`rounded-utility px-4 py-1.5 text-[14px] transition-colors ${
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

/* 每周回顾：开关 + 手动补生成。开关沿用外观区块的分段控件形态（两态），
   不为一个布尔值引入第二种开关样式 */
function WeeklyReviewCard({ review }: { review: ReviewInfo }) {
  const [enabled, setEnabled] = useState(review.enabled);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState("");

  async function toggle(next: boolean) {
    if (next === enabled || saving) return;
    setSaving(true);
    setResult("");
    try {
      const res = await fetch("/api/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) setEnabled(next);
      else setResult("✕ 保存失败");
    } catch {
      setResult("✕ 网络错误");
    } finally {
      setSaving(false);
    }
  }

  // 只入队，生成由 worker 异步完成——所以提示语说的是「已排队」而不是「已生成」
  async function generateNow() {
    setGenerating(true);
    setResult("");
    try {
      const res = await fetch("/api/review", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setResult(`✕ ${data.error || "排队失败"}`);
      else setResult(data.queued ? "✓ 已排队，稍后出现在「每周回顾」主题" : "已有回顾正在生成中");
    } catch {
      setResult("✕ 网络错误");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mt-3 rounded-card bg-surface p-6 text-[14px]">
      <p className="mb-1 font-semibold tracking-[-0.224px]">每周回顾</p>
      <p className="text-ink-48">
        每周一凌晨把上一周新建的笔记梳理成一篇回顾，存入「每周回顾」主题
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-utility bg-fill p-1">
          {[
            { value: true, label: "开启" },
            { value: false, label: "关闭" },
          ].map((o) => (
            <button
              key={o.label}
              onClick={() => toggle(o.value)}
              disabled={saving}
              aria-pressed={enabled === o.value}
              className={`rounded-utility px-4 py-1.5 text-[14px] transition-colors disabled:opacity-40 ${
                enabled === o.value
                  ? "bg-surface font-semibold text-ink ring-1 ring-hairline"
                  : "text-ink-48"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          onClick={generateNow}
          disabled={generating}
          className="rounded-utility border border-action px-4 py-1.5 text-[14px] text-action transition-transform active:scale-95 disabled:opacity-40"
        >
          {generating ? "排队中…" : "立即生成上周回顾"}
        </button>
      </div>
      {/* 记的是已排队的周，不是已成功的周：失败会出现在上方「最近失败」里 */}
      <p className="mt-2 text-[12px] text-ink-48">
        最近生成：{review.lastWeek ? `${review.lastWeek} 当周` : "从未生成"}
      </p>
      {result && (
        <p className={`mt-1 text-[12px] ${result.startsWith("✕") ? "text-danger" : "text-ink-80"}`}>
          {result}
        </p>
      )}
    </div>
  );
}

/* 数据区块：数据信任功能的聚合入口——手动备份、导出、回收站 */
function DataSection({ lastBackupAt, trashCount }: { lastBackupAt: number | null; trashCount: number }) {
  const [backedUpAt, setBackedUpAt] = useState(lastBackupAt);
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [runAi, setRunAi] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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

  /* zip 直接作为请求体发出去，不套 multipart：包可能几百 MB，
     服务端要边收边落盘，不能整个读进内存 */
  async function importZip(file: File) {
    setImporting(true);
    setImportResult("");
    try {
      const query = new URLSearchParams();
      if (overwrite) query.set("overwrite", "1");
      if (runAi) query.set("runAi", "1");
      const res = await fetch(`/api/import?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportResult(`✕ ${data.error || "导入失败"}`);
        return;
      }
      const parts = [`导入 ${data.imported} 条`];
      if (data.overwritten) parts.push(`覆盖 ${data.overwritten} 条`);
      if (data.skipped?.length) parts.push(`跳过 ${data.skipped.length} 条`);
      if (data.failed?.length) parts.push(`失败 ${data.failed.length} 条`);
      if (data.images) parts.push(`图片 ${data.images} 张`);
      if (data.topicsCreated?.length) parts.push(`新建主题 ${data.topicsCreated.join("、")}`);
      setImportResult(`✓ ${parts.join("，")}`);
    } catch {
      setImportResult("✕ 网络错误");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-[21px] font-semibold tracking-[-0.374px]">数据</h2>
      <div className="rounded-card bg-surface p-6 text-[14px]">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={backupNow}
            disabled={backingUp}
            className="rounded-utility bg-cta px-[22px] py-[8px] text-[14px] text-cta-ink transition-transform active:scale-95 disabled:opacity-40"
          >
            {backingUp ? "备份中…" : "立即备份"}
          </button>
          <span className="font-mono text-ink-48">
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
            className="rounded-utility border border-action px-[22px] py-[8px] text-[14px] text-action transition-transform active:scale-95"
          >
            导出全部数据
          </a>
          <span className="text-[12px] text-ink-48">
            Markdown + 图片打包为 zip，可导入 Obsidian 等工具
          </span>
        </div>
        <div className="mt-4 border-t border-divider pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importZip(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={importing}
              className="rounded-utility border border-action px-[22px] py-[8px] text-[14px] text-action transition-transform active:scale-95 disabled:opacity-40"
            >
              {importing ? "导入中…" : "导入 zip"}
            </button>
            <label className="flex items-center gap-1.5 text-[12px] text-ink-80">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              覆盖已存在的笔记
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-ink-80">
              <input type="checkbox" checked={runAi} onChange={(e) => setRunAi(e.target.checked)} />
              导入后交给 AI 整理
            </label>
          </div>
          {importResult && (
            <p className={`mt-2 text-[12px] ${importResult.startsWith("✕") ? "text-danger" : "text-ink-80"}`}>
              {importResult}
            </p>
          )}
          <p className="mt-2 text-[12px] text-ink-48">
            支持上面导出的 zip 与普通 Markdown zip；标题取 front-matter、一级标题或文件名，
            主题取 topic、category 或所在目录。默认跳过已存在的笔记，也不跑 AI 整理——勾上
            「交给 AI 整理」会按笔记条数消耗模型额度
          </p>
        </div>
        <div className="mt-4 border-t border-divider pt-4">
          <Link
            href="/trash"
            prefetch={true}
            className="flex items-center justify-between text-[14px] transition-opacity active:opacity-70"
          >
            <span>回收站</span>
            <span className="font-mono text-ink-48">{trashCount > 0 ? `${trashCount} 条 ›` : "›"}</span>
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
  image,
  reasoning,
  embedding,
  apiTokens,
  correctionLearning,
  queue,
  review,
  lastBackupAt,
  trashCount,
}: {
  topics: TopicRow[];
  llm: LlmInfo;
  vision: VisionInfo;
  // 图像生成配置，来源语义与视觉模型一致（留空回落文本模型）
  image: VisionInfo;
  reasoning: ReasoningInfo;
  embedding: EmbeddingInfo;
  apiTokens: ApiTokenInfo[];
  correctionLearning: CorrectionInfo;
  queue: QueueInfo;
  review: ReviewInfo;
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
  const [visionTesting, setVisionTesting] = useState(false);
  const [visionTestResult, setVisionTestResult] = useState("");
  // 图像模型表单：与视觉模型同构，baseUrl/apiKey 留空回落文本模型配置
  const [imageModel, setImageModel] = useState(image.model);
  const [imageBaseUrl, setImageBaseUrl] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");
  const [imageSaving, setImageSaving] = useState(false);
  const [imageResult, setImageResult] = useState("");
  const [imageTesting, setImageTesting] = useState(false);
  const [imageTestResult, setImageTestResult] = useState("");
  // 深度思考模型表单：与视觉/图像模型同构，baseUrl/apiKey 留空回落文本模型配置
  const [reasoningModel, setReasoningModel] = useState(reasoning.model);
  const [reasoningBaseUrl, setReasoningBaseUrl] = useState("");
  const [reasoningApiKey, setReasoningApiKey] = useState("");
  const [reasoningSaving, setReasoningSaving] = useState(false);
  const [reasoningResult, setReasoningResult] = useState("");
  const [reasoningTesting, setReasoningTesting] = useState(false);
  const [reasoningTestResult, setReasoningTestResult] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState(embedding.model);
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [embeddingSaving, setEmbeddingSaving] = useState(false);
  const [embeddingResult, setEmbeddingResult] = useState("");
  const [embeddingTesting, setEmbeddingTesting] = useState(false);
  const [embeddingTestResult, setEmbeddingTestResult] = useState("");
  const [embeddingBackfill, setEmbeddingBackfill] = useState<{ missing: number; stale: number } | null>(null);
  /* 这一组不回落文本模型，所以「只填了一部分」既不会兜底也不会报错，功能直接静默不启用。
     更隐蔽的是 baseUrl 单独兜底到环境变量：模型名填对了，请求却打去了另一个服务——
     实测踩过一次，页面上一切正常，向量却是别处产出的。故把生效的接入点原样显示出来。 */
  const embeddingMissing = [
    embedding.sources.baseUrl === "none" ? "接入点" : null,
    embedding.sources.model === "none" ? "模型名" : null,
    embedding.sources.apiKey === "none" ? "API Key" : null,
  ].filter(Boolean);
  const [embeddingBackfillResult, setEmbeddingBackfillResult] = useState("");
  async function saveReasoning() {
    const body: Record<string, string> = {};
    if (reasoningModel.trim() !== reasoning.model) body.reasoningModel = reasoningModel.trim();
    if (reasoningBaseUrl.trim()) body.reasoningBaseUrl = reasoningBaseUrl.trim();
    if (reasoningApiKey.trim()) body.reasoningApiKey = reasoningApiKey.trim();
    if (!Object.keys(body).length) return setReasoningResult("没有修改的内容");
    setReasoningSaving(true); setReasoningResult("");
    try { const res = await fetch("/api/settings/llm", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) throw new Error(); setReasoningApiKey(""); setReasoningBaseUrl(""); setReasoningResult("已保存，立即生效"); router.refresh(); } catch { setReasoningResult("保存失败"); } finally { setReasoningSaving(false); }
  }

  async function saveEmbedding() {
    const body: Record<string, string> = {};
    if (embeddingModel.trim() !== embedding.model) body.embeddingModel = embeddingModel.trim();
    if (embeddingBaseUrl.trim()) body.embeddingBaseUrl = embeddingBaseUrl.trim();
    if (embeddingApiKey.trim()) body.embeddingApiKey = embeddingApiKey.trim();
    if (!Object.keys(body).length) return setEmbeddingResult("没有修改的内容");
    setEmbeddingSaving(true); setEmbeddingResult("");
    try {
      const res = await fetch("/api/settings/llm", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      setEmbeddingApiKey(""); setEmbeddingBaseUrl(""); setEmbeddingResult("已保存，立即生效"); router.refresh();
    } catch { setEmbeddingResult("保存失败"); } finally { setEmbeddingSaving(false); }
  }

  async function loadEmbeddingBackfill() {
    const res = await fetch("/api/embedding/backfill");
    if (res.ok) setEmbeddingBackfill(await res.json());
  }

  async function enqueueEmbeddingBackfill() {
    setEmbeddingBackfillResult("排队中…");
    try {
      const res = await fetch("/api/embedding/backfill", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setEmbeddingBackfillResult(res.ok ? `已排队 ${data.queued ?? 0} 条` : `失败：${data.error ?? "未知错误"}`);
      if (res.ok) setEmbeddingBackfill(data);
    } catch { setEmbeddingBackfillResult("网络错误"); }
  }

  async function saveImageConfig() {
    const body: Record<string, string> = {};
    if (imageModel.trim() !== image.model) body.imageModel = imageModel.trim();
    if (imageBaseUrl.trim()) body.imageBaseUrl = imageBaseUrl.trim();
    if (imageApiKey.trim()) body.imageApiKey = imageApiKey.trim();
    if (Object.keys(body).length === 0) {
      setImageResult("没有修改的内容");
      return;
    }
    setImageSaving(true);
    setImageResult("");
    try {
      const res = await fetch("/api/settings/llm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setImageApiKey("");
        setImageBaseUrl("");
        setImageResult("✓ 已保存，立即生效");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setImageResult(`✕ ${data.error || "保存失败"}`);
      }
    } catch {
      setImageResult("✕ 网络错误");
    } finally {
      setImageSaving(false);
    }
  }

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

  // 四组配置共用一个测试入口，target 决定打哪个端点
  async function testLlm(target: "text" | "vision" | "image" | "reasoning" | "embedding") {
    const setBusy =
      target === "vision"
        ? setVisionTesting
        : target === "image"
          ? setImageTesting
        : target === "reasoning"
            ? setReasoningTesting
            : target === "embedding"
              ? setEmbeddingTesting
            : setTesting;
    const setResult =
      target === "vision"
        ? setVisionTestResult
        : target === "image"
          ? setImageTestResult
        : target === "reasoning"
            ? setReasoningTestResult
            : target === "embedding"
              ? setEmbeddingTestResult
            : setTestResult;
    setBusy(true);
    setResult("");
    try {
      const res = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      // 连得上但不支持工具调用属"能力受限"而非失败，用 ⚠ 与成功区分，避免扫一眼误判为正常
      const mark = !data.ok ? "✕" : data.supportsTools === false ? "⚠" : "✓";
      setResult(`${mark} ${data.message}`);
    } catch {
      setResult("✕ 请求失败");
    } finally {
      setBusy(false);
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
          <h1 className="font-serif text-display leading-[1.1] tracking-[-0.4px]">
            设置
          </h1>
        </header>
        <h2 className="mb-3 text-[21px] font-semibold tracking-[-0.374px]">主题管理</h2>
        <form onSubmit={createTopic} className="mb-3 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新主题名，如：羽毛球"
            className="h-[40px] flex-1 rounded-utility border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="rounded-utility bg-cta px-[22px] py-[8px] text-[14px] text-cta-ink transition-transform active:scale-95 disabled:opacity-40"
          >
            创建
          </button>
        </form>
        {error && <p className="mb-2 text-[14px] text-danger">{error}</p>}
        <ul className="divide-y divide-divider rounded-card bg-surface">
          {topics.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-6 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold tracking-[-0.224px]">
                  {t.isSystem ? "未分类" : t.name}
                </p>
                <p className="font-mono text-meta text-ink-48">{t.noteCount} 条笔记</p>
              </div>
              {!t.isSystem && (
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => renameTopic(t)}
                    className="rounded-utility px-3 py-1 text-[12px] text-action transition-transform active:scale-95"
                  >
                    重命名
                  </button>
                  <button
                    onClick={() => setPendingDeleteTopic(t)}
                    className="rounded-utility px-3 py-1 text-[12px] text-danger transition-transform active:scale-95"
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
        <div className="space-y-4 rounded-card bg-surface p-6 text-[14px]">
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span className="text-ink-48">接入点</span>
              <span className="text-[12px] text-ink-48">{SOURCE_LABEL[llm.sources.baseUrl]}</span>
            </label>
            <input
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
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
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
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
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <ShadowNotice shadowed={llm.shadowed} />
          <p className="text-[12px] text-ink-48">
            此处保存的配置存入数据库并立即生效；未保存的项使用服务端环境变量
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={saveLlm}
              disabled={llmSaving}
              className="rounded-utility bg-cta px-[22px] py-[8px] text-[14px] text-cta-ink transition-transform active:scale-95 disabled:opacity-40"
            >
              {llmSaving ? "保存中…" : "保存"}
            </button>
            <button
              onClick={() => testLlm("text")}
              disabled={testing}
              className="rounded-utility border border-action px-4 py-1.5 text-[14px] text-action transition-transform active:scale-95 disabled:opacity-40"
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
            <p className={`text-[12px] ${testResult.startsWith("✕") ? "text-danger" : "text-ink-80"}`}>
              {testResult}
            </p>
          )}
        </div>

        {/* 字段顺序与上方文本模型保持一致：接入点 → 模型 → API Key */}
        <div className="mt-3 space-y-4 rounded-card bg-surface p-6 text-[14px]">
          <p className="font-semibold tracking-[-0.224px]">视觉模型（AI 读图，可选）</p>
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span className="text-ink-48">接入点</span>
              <span className="text-[12px] text-ink-48">
                {VISION_SOURCE_LABEL[vision.sources.baseUrl]}
              </span>
            </label>
            <input
              value={visionBaseUrl}
              onChange={(e) => setVisionBaseUrl(e.target.value)}
              placeholder={vision.baseUrl || "https://…/v1"}
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span className="text-ink-48">模型</span>
              <span className="text-[12px] text-ink-48">
                {VISION_SOURCE_LABEL[vision.sources.model]}
              </span>
            </label>
            <input
              value={visionModel}
              onChange={(e) => setVisionModel(e.target.value)}
              placeholder="如 qwen-vl-plus / gpt-4o；留空表示不启用 AI 读图"
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span className="text-ink-48">API Key</span>
              <span className="text-[12px] text-ink-48">
                {VISION_SOURCE_LABEL[vision.sources.apiKey]}
              </span>
            </label>
            <input
              type="password"
              value={visionApiKey}
              onChange={(e) => setVisionApiKey(e.target.value)}
              placeholder={
                vision.sources.apiKey === "none"
                  ? "sk-…"
                  : vision.sources.apiKey === "fallback"
                    ? `复用上方 ${vision.apiKeyMasked}`
                    : `当前 ${vision.apiKeyMasked}，留空则不修改`
              }
              autoComplete="off"
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <ShadowNotice shadowed={vision.shadowed} />
          {/* 与文本模型的语义差异：这里留空是"回落文本模型"，不是"不修改" */}
          <p className="text-[12px] text-ink-48">
            只填模型名即可启用；接入点与 API Key 留空会自动复用上方文本模型的配置
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={saveVision}
              disabled={visionSaving}
              className="rounded-utility bg-cta px-[22px] py-[8px] text-[14px] text-cta-ink transition-transform active:scale-95 disabled:opacity-40"
            >
              {visionSaving ? "保存中…" : "保存"}
            </button>
            <button
              onClick={() => testLlm("vision")}
              disabled={visionTesting}
              className="rounded-utility border border-action px-4 py-1.5 text-[14px] text-action transition-transform active:scale-95 disabled:opacity-40"
            >
              {visionTesting ? "测试中…" : "测试连接"}
            </button>
          </div>
          {visionResult && (
            <p className={`text-[12px] ${visionResult.startsWith("✕") ? "text-danger" : "text-ink-80"}`}>
              {visionResult}
            </p>
          )}
          {visionTestResult && (
            <p
              className={`text-[12px] ${visionTestResult.startsWith("✕") ? "text-danger" : "text-ink-80"}`}
            >
              {visionTestResult}
            </p>
          )}
        </div>

        {/* 图像模型：字段序与前两组一致。只支持 OpenAI 兼容的同步生图接口
            （POST {接入点}/images/generations），取舍见 docs/adr/0011 */}
        <div className="mt-3 space-y-4 rounded-card bg-surface p-6 text-[14px]">
          <p className="font-semibold tracking-[-0.224px]">图像模型（AI 生图，可选）</p>
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span className="text-ink-48">接入点</span>
              <span className="text-[12px] text-ink-48">
                {VISION_SOURCE_LABEL[image.sources.baseUrl]}
              </span>
            </label>
            <input
              value={imageBaseUrl}
              onChange={(e) => setImageBaseUrl(e.target.value)}
              placeholder={image.baseUrl || "https://…/v1"}
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span className="text-ink-48">模型</span>
              <span className="text-[12px] text-ink-48">
                {VISION_SOURCE_LABEL[image.sources.model]}
              </span>
            </label>
            <input
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value)}
              placeholder="如 cogview-3 / gpt-image-1；留空表示不启用 AI 生图"
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span className="text-ink-48">API Key</span>
              <span className="text-[12px] text-ink-48">
                {VISION_SOURCE_LABEL[image.sources.apiKey]}
              </span>
            </label>
            <input
              type="password"
              value={imageApiKey}
              onChange={(e) => setImageApiKey(e.target.value)}
              placeholder={
                image.sources.apiKey === "none"
                  ? "sk-…"
                  : image.sources.apiKey === "fallback"
                    ? `复用上方 ${image.apiKeyMasked}`
                    : `当前 ${image.apiKeyMasked}，留空则不修改`
              }
              autoComplete="off"
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 text-[14px] outline-none focus:border-action-focus"
            />
          </div>
          <ShadowNotice shadowed={image.shadowed} />
          <p className="text-[12px] text-ink-48">
            只填模型名即可启用；接入点与 API Key 留空会自动复用上方文本模型的配置。
            需要接入点支持 OpenAI 兼容的
            <code className="mx-1 rounded bg-fill px-1">/images/generations</code>
            同步接口
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={saveImageConfig}
              disabled={imageSaving}
              className="rounded-utility bg-cta px-[22px] py-[8px] text-[14px] text-cta-ink transition-transform active:scale-95 disabled:opacity-40"
            >
              {imageSaving ? "保存中…" : "保存"}
            </button>
            <button
              onClick={() => testLlm("image")}
              disabled={imageTesting}
              className="rounded-utility border border-action px-4 py-1.5 text-[14px] text-action transition-transform active:scale-95 disabled:opacity-40"
            >
              {imageTesting ? "生成中…" : "测试连接"}
            </button>
            {/* 与另两组的差别：这个测试真的会花钱，必须说在按钮旁边 */}
            <span className="text-[12px] text-ink-48">测试会真实生成一张图，消耗一次额度</span>
          </div>
          {imageResult && (
            <p className={`text-[12px] ${imageResult.startsWith("✕") ? "text-danger" : "text-ink-80"}`}>
              {imageResult}
            </p>
          )}
          {imageTestResult && (
            <p
              className={`text-[12px] ${imageTestResult.startsWith("✕") ? "text-danger" : "text-ink-80"}`}
            >
              {imageTestResult}
            </p>
          )}
        </div>

        <div className="mt-3 rounded-card bg-surface p-6 text-[14px]">
          <p className="mb-1 font-semibold tracking-[-0.224px]">AI 任务队列</p>
          <p className="font-mono text-ink-48">
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

        {/* 深度思考模型：字段序与前三组一致。测试连接会连通性、是否外露思考过程、
            是否支持工具调用一次测完——工具能力必须单独探测并落库，助手据此
            决定开着深度思考时要不要下发工具（含生图），见 docs/adr/0015 */}
        <div className="mt-3 rounded-card bg-surface p-6 text-[14px]">
          <p className="font-semibold tracking-[-0.224px]">深度思考模型（可选）</p>
          <p className="mt-1 text-[12px] leading-[1.5] text-ink-48">
            模型名必须显式配置；接入点和 Key 留空时回落普通文本模型。助手输入框的「深度思考」开关默认关闭，逐条消息生效、不记忆。
          </p>
          <div className="mt-3 space-y-3">
            <input
              value={reasoningBaseUrl}
              onChange={(e) => setReasoningBaseUrl(e.target.value)}
              placeholder={reasoning.baseUrl || "接入点"}
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 outline-none focus:border-action-focus"
            />
            <input
              value={reasoningModel}
              onChange={(e) => setReasoningModel(e.target.value)}
              placeholder="模型名"
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 outline-none focus:border-action-focus"
            />
            <input
              type="password"
              value={reasoningApiKey}
              onChange={(e) => setReasoningApiKey(e.target.value)}
              placeholder={`API Key（${reasoning.apiKeyMasked}）`}
              className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 outline-none focus:border-action-focus"
            />
            <ShadowNotice shadowed={reasoning.shadowed} />
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={saveReasoning}
                disabled={reasoningSaving}
                className="rounded-utility bg-cta px-[22px] py-[8px] text-cta-ink transition-transform active:scale-95 disabled:opacity-40"
              >
                {reasoningSaving ? "保存中…" : "保存"}
              </button>
              <button
                onClick={() => testLlm("reasoning")}
                disabled={reasoningTesting}
                className="rounded-utility border border-hairline px-[22px] py-[8px] text-ink-80 transition-transform active:scale-95 disabled:opacity-40"
              >
                {reasoningTesting ? "测试中…" : "测试连接"}
              </button>
              {reasoningResult && <span className="text-[12px] text-ink-48">{reasoningResult}</span>}
            </div>
            {reasoningTestResult && (
              <p className="text-[12px] leading-[1.5] text-ink-48">{reasoningTestResult}</p>
            )}
            <p className="text-[12px] leading-[1.5] text-ink-48">
              没测过工具能力时助手照常下发工具；只有测出「不支持」才降级为纯问答。
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-card bg-surface p-6 text-[14px]">
          <p className="font-semibold tracking-[-0.224px]">Embedding 模型（语义搜索，可选）</p>
          <p className="mt-1 text-[12px] leading-[1.5] text-ink-48">
            三项必须单独配置，不会回落文本模型；需使用提供 /embeddings 接口的供应商。向量仅用于语义检索，BM25 始终保留。
          </p>
          <p className="mt-2 text-[12px] leading-[1.5] text-ink-80">
            {embeddingMissing.length > 0
              ? `未启用：还缺 ${embeddingMissing.join("、")}。三项缺一即视为未配置，搜索将继续使用 BM25。`
              : `已启用 · 当前生效接入点 ${embedding.baseUrl}`}
          </p>
          <div className="mt-3 space-y-3">
            <div>
              <label className="mb-1 flex items-center justify-between">
                <span className="text-ink-48">接入点</span>
                <span className="text-[12px] text-ink-48">{SOURCE_LABEL[embedding.sources.baseUrl]}</span>
              </label>
              <input value={embeddingBaseUrl} onChange={(e) => setEmbeddingBaseUrl(e.target.value)} placeholder={embedding.baseUrl || "接入点，如 https://…/v1"} className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 outline-none focus:border-action-focus" />
            </div>
            <div>
              <label className="mb-1 flex items-center justify-between">
                <span className="text-ink-48">模型</span>
                <span className="text-[12px] text-ink-48">{SOURCE_LABEL[embedding.sources.model]}</span>
              </label>
              <input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} placeholder="模型名，如 text-embedding-v3" className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 outline-none focus:border-action-focus" />
            </div>
            <div>
              <label className="mb-1 flex items-center justify-between">
                <span className="text-ink-48">API Key</span>
                <span className="text-[12px] text-ink-48">{SOURCE_LABEL[embedding.sources.apiKey]}</span>
              </label>
              <input type="password" value={embeddingApiKey} onChange={(e) => setEmbeddingApiKey(e.target.value)} placeholder={`API Key（${embedding.apiKeyMasked}）`} className="h-[40px] w-full rounded-utility border border-hairline bg-surface px-5 outline-none focus:border-action-focus" autoComplete="off" />
            </div>
            <ShadowNotice shadowed={embedding.shadowed} />
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={saveEmbedding} disabled={embeddingSaving} className="rounded-utility bg-cta px-[22px] py-[8px] text-cta-ink disabled:opacity-40">{embeddingSaving ? "保存中…" : "保存"}</button>
              <button onClick={() => testLlm("embedding")} disabled={embeddingTesting} className="rounded-utility border border-hairline px-[22px] py-[8px] text-ink-80 disabled:opacity-40">{embeddingTesting ? "测试中…" : "测试连接"}</button>
              {embeddingResult && <span className="text-[12px] text-ink-48">{embeddingResult}</span>}
            </div>
            {embeddingTestResult && <p className="text-[12px] leading-[1.5] text-ink-48">{embeddingTestResult}</p>}
            <div className="border-t border-divider pt-3">
              <button onClick={() => { void loadEmbeddingBackfill(); }} className="mr-3 rounded-utility border border-hairline px-3 py-1.5 text-[12px] text-ink-80">查看待补算</button>
              <button onClick={enqueueEmbeddingBackfill} className="rounded-utility border border-action px-3 py-1.5 text-[12px] text-action">补算向量</button>
              {embeddingBackfill && <span className="ml-3 text-[12px] text-ink-48">缺失 {embeddingBackfill.missing} · 过期 {embeddingBackfill.stale}</span>}
              {embeddingBackfillResult && <p className="mt-2 text-[12px] text-ink-48">{embeddingBackfillResult}</p>}
              {/* 长笔记分块上线后，升级前算的整篇向量会一次性全部计入「过期」。
                  不说明的话，用户什么都没改却看到一批过期，会当成 bug */}
              <p className="mt-2 text-[12px] leading-[1.5] text-ink-48">长笔记会切成多块分别建立向量，末尾内容才不会被整篇稀释。升级到分块版本后，此前算好的向量会一次性显示为过期，补算一次即可。</p>
            </div>
          </div>
        </div>

        <WeeklyReviewCard review={review} />
      </section>

      <DataSection lastBackupAt={lastBackupAt} trashCount={trashCount} />

      <ApiTokenSection initial={apiTokens} />
      <CorrectionSection initial={correctionLearning} />

      <section>
        <h2 className="mb-3 text-[21px] font-semibold tracking-[-0.374px]">账号</h2>
        <button
          onClick={logout}
          className="rounded-utility bg-surface px-[22px] py-[8px] text-[14px] text-ink-80 transition-transform active:scale-95"
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
