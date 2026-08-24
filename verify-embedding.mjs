// 一次性工具：验证 embedding 供应商可用性（对应实施计划的「任务 0」）
// 用法：
//   EMBEDDING_BASE_URL=https://... EMBEDDING_API_KEY=sk-... EMBEDDING_MODEL=... node verify-embedding.mjs
// 验完可直接删除本文件；若想长期保留，建议移到 scripts/ 下。

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

const res = await fetch(`${baseUrl}/embeddings`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, input: SAMPLES }),
});

if (!res.ok) {
  console.error(`✗ HTTP ${res.status}`);
  console.error((await res.text()).slice(0, 600));
  console.error("\n404 多半是该供应商没有 /embeddings 接口（DeepSeek、Anthropic 都没有），需要另找供应商。");
  process.exit(1);
}

const json = await res.json();
if (!Array.isArray(json.data) || json.data.length !== SAMPLES.length) {
  console.error("✗ 响应结构不是 OpenAI 兼容格式：", JSON.stringify(json).slice(0, 400));
  process.exit(1);
}

const vecs = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
const dim = vecs[0].length;
const near = cosine(vecs[0], vecs[1]);
const far = cosine(vecs[0], vecs[2]);

console.log(`✓ 接口可用，返回维度 ${dim}`);
console.log(`  实施计划里 embedding_dim 的典型值就填这个数：${dim}`);
console.log(`  内存估算：1 万条笔记 ≈ ${((dim * 4 * 10000) / 1024 / 1024).toFixed(1)} MB`);
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
