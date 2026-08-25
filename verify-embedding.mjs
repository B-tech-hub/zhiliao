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

/* 五组「笔记原话 ↔ 口语化查询」配对，两侧用词刻意不重叠，外加一条无关对照。
   为什么不是一组：2026-08-26 实测中，只用「又摸鱼了一下午 ↔ 拖延」这一组、并拿
   「今晚羽毛球多球训练」当对照时，Qwen3-Embedding-4B 只得到 0.0393 的区分度、
   低于阈值，看起来还不如 8B 的 0.1570；扩到五组后 4B 反而最优（平均间隔 0.3536
   对 0.2814）。两个原因叠在一起：单组抽样噪声大；而那条对照本身选得太近——「摸鱼」
   与「羽毛球训练」同属日常活动，对照相似度被推到 0.4569，间隔自然被压扁。
   所以对照要选真正跨领域的句子（这里用「拉面店」），且必须多组取平均。
   这件事值得谨慎：换模型会让全部存量向量作废、需要重新补算。 */
const PAIRS = [
  ["又摸鱼了一下午，啥也没干成", "拖延"],
  ["今晚羽毛球多球训练，杀球终于有点下压了", "羽毛球有进步"],
  ["昨晚只睡了四个小时，白天完全没状态", "睡眠不足影响状态"],
  ["读完那本讲习惯的书，核心观点是先改环境", "习惯养成的方法"],
  ["又在会上没敢把自己的想法说出来", "不敢表达"],
];
const DECOY = "中午那家新开的拉面店味道一般";
const INPUTS = [...PAIRS.map((p) => p[0]), ...PAIRS.map((p) => p[1]), DECOY];

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
    body: JSON.stringify({ model, input: INPUTS }),
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
  if (res.status === 404) {
    console.error("\n404 多半是该供应商没有 /embeddings 接口（DeepSeek、Anthropic 都没有），需要另找供应商。");
  } else if (res.status === 403) {
    console.error("\n403 若返回的是 HTML 而非 JSON，多半被 WAF 拦在鉴权层之前——先看响应头 cf-ray 的落地节点，");
    console.error("经代理出国的出口 IP 常被网关拦截，换直连出口往往即可恢复，与 Key 是否正确无关。");
  } else if (res.status === 522) {
    console.error("\n522 是网关连不上后端：该模型多半在这个接入点上并未实际部署，换模型名再试。");
  }
  process.exit(1);
}

const json = await res.json();
if (!Array.isArray(json.data) || json.data.length !== INPUTS.length) {
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

const n = PAIRS.length;
const noteVecs = vecs.slice(0, n);
const queryVecs = vecs.slice(n, n * 2);
const decoyVec = vecs[n * 2];

console.log(`✓ 接口可用，返回维度 ${dim}`);
console.log(`  批量输入 ${INPUTS.length} 条，返回 ${vecs.length} 条，请求耗时 ${elapsedMs} ms`);
console.log(`  实施计划里 embedding_dim 的典型值就填这个数：${dim}`);
console.log(`  内存估算：1 万条笔记 ≈ ${((dim * 4 * 10000) / 1024 / 1024).toFixed(1)} MB`);
if (json.usage) {
  console.log(`  输入 token：${json.usage.prompt_tokens ?? "供应商未提供"}`);
  console.log(`  总 token：${json.usage.total_tokens ?? "供应商未提供"}`);
} else {
  console.log("  token 用量：供应商未返回 usage");
}
console.log("");

// 每个查询要在「全部笔记 + 对照」里选出自己的配对笔记才算命中，比单看相似度绝对值更接近真实检索
let hits = 0;
const gaps = [];
for (let i = 0; i < n; i++) {
  const sTrue = cosine(queryVecs[i], noteVecs[i]);
  const sDecoy = cosine(queryVecs[i], decoyVec);
  let best = sDecoy, bestIndex = -1;
  for (let j = 0; j < n; j++) {
    const s = cosine(queryVecs[i], noteVecs[j]);
    if (s > best) { best = s; bestIndex = j; }
  }
  const ok = bestIndex === i;
  if (ok) hits++;
  gaps.push(sTrue - sDecoy);
  console.log(`  ${ok ? "✓" : "✗"} 「${PAIRS[i][1]}」→ 「${PAIRS[i][0]}」  相似度 ${sTrue.toFixed(4)}  对照 ${sDecoy.toFixed(4)}  间隔 ${(sTrue - sDecoy).toFixed(4)}`);
}
const avgGap = gaps.reduce((a, b) => a + b, 0) / n;
console.log("");
console.log(`  配对命中 ${hits}/${n}，平均判别间隔 ${avgGap.toFixed(4)}`);
console.log("");

if (hits === n && avgGap > 0.05) {
  console.log("判定：可用。每个口语化查询都选中了自己的原话笔记，能支撑「搜『拖延』召回『摸鱼』」这条验收。");
} else if (hits >= Math.ceil(n * 0.8) && avgGap > 0.03) {
  console.log(`判定：基本可用（${hits}/${n}）。可以先用，但建议再换一两个模型对比——同一接入点上不同规模的模型差距可能很大。`);
} else if (hits > 0) {
  console.log(`判定：偏弱（${hits}/${n}）。向量在混合检索里的贡献会很有限，建议换模型再测。`);
  console.log("提示：不要只看单组相似度就换模型——换模型会让全部存量向量作废，需要重新补算。");
} else {
  console.log("判定：不可用。没有任何查询选中自己的原话笔记，这个模型不适合中文语义检索，换一个。");
  process.exit(1);
}
