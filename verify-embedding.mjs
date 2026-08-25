// 一次性工具：验证 embedding 供应商可用性（对应实施计划的「任务 0」）
// 用法：
//   node verify-embedding.mjs
//   （脚本会自动读取 .env.local；显式传入的环境变量优先。）
// 验完可直接删除本文件；若想长期保留，建议移到 scripts/ 下。

import { existsSync } from "node:fs";

// Node 不会默认读取 .env.local；这里显式加载，避免 README 给出的命令在
// 配置已写入本地文件时仍误报「三项缺失」。不打印任何配置值。
if (typeof process.loadEnvFile === "function") {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

const baseUrl = process.env.EMBEDDING_BASE_URL?.replace(/\/$/, "");
const apiKey = process.env.EMBEDDING_API_KEY;
const model = process.env.EMBEDDING_MODEL;

if (!baseUrl || !apiKey || !model) {
  console.error("缺少配置。三项都要给：EMBEDDING_BASE_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL");
  process.exit(1);
}

// 第一句与第二句语义相近但用词完全不重叠，第三句是对照组
const SAMPLES = ["又摸鱼了一下午", "拖延", "今晚羽毛球多球训练"];

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function redact(value) {
  return String(value)
    .split(apiKey).join("[REDACTED]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/gi, "[REDACTED]");
}

const startedAt = performance.now();
let res;
try {
  res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: SAMPLES }),
    signal: AbortSignal.timeout(Number(process.env.EMBEDDING_TIMEOUT_MS) || 60000),
  });
} catch (error) {
  const cause = error?.cause?.code ?? error?.code ?? error?.name ?? "未知错误";
  console.error(`✗ 网络请求失败：${redact(cause)}`);
  process.exit(1);
}
const elapsedMs = Math.round(performance.now() - startedAt);

if (!res.ok) {
  const contentType = res.headers.get("content-type") ?? "未知";
  const body = await res.text().catch(() => "");
  let detail = `响应类型 ${contentType}`;
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message ?? parsed?.message ?? detail;
  } catch { /* HTML 等非 JSON 错误不回显正文，避免把网关页面或敏感信息带进日志 */ }
  console.error(`✗ HTTP ${res.status}（${redact(detail).slice(0, 300)}）`);
  console.error("\n404 多半是该供应商没有 /embeddings 接口（DeepSeek、Anthropic 都没有），需要另找供应商。");
  process.exit(1);
}

const json = await res.json();
if (!Array.isArray(json.data) || json.data.length !== SAMPLES.length) {
  console.error("✗ 响应结构不是 OpenAI 兼容格式");
  process.exit(1);
}

const vecs = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
if (vecs.some((vector) => !Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value)))) {
  console.error("✗ 响应包含无效向量");
  process.exit(1);
}
const dim = vecs[0].length;
if (vecs.some((vector) => vector.length !== dim)) {
  console.error("✗ 同一批响应的向量维度不一致");
  process.exit(1);
}
const near = cosine(vecs[0], vecs[1]);
const far = cosine(vecs[0], vecs[2]);

console.log(`✓ 接口可用，返回维度 ${dim}`);
console.log(`  批量输入 ${SAMPLES.length} 条，返回 ${vecs.length} 条，请求耗时 ${elapsedMs} ms`);
console.log(`  实施计划里 embedding_dim 的典型值就填这个数：${dim}`);
console.log(`  内存估算：1 万条笔记 ≈ ${((dim * 4 * 10000) / 1024 / 1024).toFixed(1)} MB`);
if (json.usage) {
  console.log(`  输入 token：${json.usage.prompt_tokens ?? "供应商未提供"}`);
  console.log(`  总 token：${json.usage.total_tokens ?? "供应商未提供"}`);
} else {
  console.log("  token 用量：供应商未返回 usage");
}
console.log("");
console.log(`  「${SAMPLES[0]}」×「${SAMPLES[1]}」= ${near.toFixed(4)}  （语义相近，应偏高）`);
console.log(`  「${SAMPLES[0]}」×「${SAMPLES[2]}」= ${far.toFixed(4)}  （无关对照，应偏低）`);
console.log(`  区分度 = ${(near - far).toFixed(4)}`);
console.log("");

if (near > far && near - far > 0.05) {
  console.log("判定：可用。相近语义的分数明显高于无关对照，能支撑「搜『拖延』召回『摸鱼』」这条验收。");
} else if (near > far) {
  console.log("判定：勉强可用但区分度偏小，混合检索里向量的贡献会很弱，建议换个模型再测一次。");
} else {
  console.log("判定：不可用。相近语义反而不如无关对照，这个模型不适合中文语义检索，换一个。");
  process.exit(1);
}
