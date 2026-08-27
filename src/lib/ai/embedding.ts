// OpenAI 兼容 Embeddings API。嵌入配置必须三项齐全，不继承聊天模型配置。
import { getEmbeddingConfig } from "@/lib/llm-config";
import { formatLlmHttpError, LlmConfigError, LlmRequestError } from "@/lib/llm";

const BATCH_SIZE = 64;
/* 多数 embedding 模型上限 8192 token，中文按 1 字≈1.5 token 保守估算约 5400 字。
   取 5000 留出标题/摘要拼接与分隔符的余量——超限不会降级，供应商直接回 400。 */
const MAX_INPUT_CHARS = 5000;

export function buildNoteEmbeddingText(note: { title: string; summary: string | null; content: string }): string {
  const parts = [note.title.trim(), note.summary?.trim() ?? "", note.content.trim()].filter(Boolean);
  return parts.join("\n\n").slice(0, MAX_INPUT_CHARS);
}

/* 分块参数。上限 1000 字：实测 1426 字笔记按 ## 切分后最佳块 0.5623 vs 整篇 0.4770，
   粒度再大就回到稀释，再小则每块都缺上下文。下限 200 字避免产生无上下文的碎片。
   块数封顶 20（约 2 万字）纯为兜住异常长文，防止一条笔记打爆单次请求。 */
export const CHUNK_MAX_CHARS = 1000;
export const CHUNK_MIN_CHARS = 200;
export const CHUNK_MAX_COUNT = 20;

export interface ChunkOptions {
  maxChars?: number;
  minChars?: number;
  maxChunks?: number;
  /* 标题是否随每块重复注入。默认开启：按 ## 切分时含标题的首块会吸走权重
     （实测最高分块是标题块而非术语所在块），每块都带标题才能抹平首块的结构性优势。
     留成开关是为了能用同一组样本实测对比两种切法，而不是靠推理定论。 */
  injectTitle?: boolean;
}

// 按空行段落把超长片段切开；单段仍超长则硬切（无结构可依时字数是唯一依据）
function splitOversized(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  let buf = "";
  for (const para of text.split(/\n\s*\n/)) {
    if (!para.trim()) continue;
    if (buf && buf.length + para.length + 2 > maxChars) {
      out.push(buf);
      buf = "";
    }
    if (para.length > maxChars) {
      if (buf) { out.push(buf); buf = ""; }
      for (let i = 0; i < para.length; i += maxChars) out.push(para.slice(i, i + maxChars));
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/* 把笔记正文切成待 embedding 的块。返回长度 <= 1 表示该笔记不需要分块，
   调用方应走 buildNoteEmbeddingText 的单块路径（短笔记不该产生额外行）。

   摘要刻意不进分块：它是整篇的概括，注入每块会让所有块彼此靠近、抹平块间差异，
   等于白分块。笔记标题够承担「这块属于哪条笔记」的上下文。 */
export function buildNoteChunks(
  note: { title: string; summary: string | null; content: string },
  options: ChunkOptions = {},
): string[] {
  const maxChars = options.maxChars ?? CHUNK_MAX_CHARS;
  const minChars = options.minChars ?? CHUNK_MIN_CHARS;
  const maxChunks = options.maxChunks ?? CHUNK_MAX_COUNT;
  const injectTitle = options.injectTitle ?? true;

  const content = note.content.trim();
  if (!content) return [];

  // 先按 Markdown 标题分节，标题行归入其后那一节
  const sections: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.some((l) => l.trim())) sections.push(cur.join("\n").trim());
    cur = [];
  };
  for (const line of content.split("\n")) {
    if (/^#{1,6}\s/.test(line)) flush();
    cur.push(line);
  }
  flush();

  const pieces = sections.flatMap((s) => splitOversized(s, maxChars));

  // 过短的片段并入前一块。尾块没有下一块可并，只能回并前一块——
  // 这一步允许略微超过 maxChars（最多 maxChars + minChars），仍远低于 MAX_INPUT_CHARS
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.length < minChars && last.length + piece.length + 2 <= maxChars) {
      merged[merged.length - 1] = `${last}\n\n${piece}`;
    } else {
      merged.push(piece);
    }
  }
  while (merged.length >= 2 && merged[merged.length - 1].length < minChars) {
    const tail = merged.pop() as string;
    merged[merged.length - 1] = `${merged[merged.length - 1]}\n\n${tail}`;
  }

  /* 超出块数上限时合并最短的相邻对，而不是丢弃尾部——末尾内容进不了向量
     正是分块要解决的问题，为了守住块数上限把它扔掉等于白做 */
  while (merged.length > maxChunks) {
    let bestIndex = 0;
    let bestLength = Infinity;
    for (let i = 0; i < merged.length - 1; i++) {
      const length = merged[i].length + merged[i + 1].length;
      if (length < bestLength) { bestLength = length; bestIndex = i; }
    }
    merged.splice(bestIndex, 2, `${merged[bestIndex]}\n\n${merged[bestIndex + 1]}`);
  }

  const title = note.title.trim();
  return merged.map((piece) =>
    (injectTitle && title ? `${title}\n\n${piece}` : piece).slice(0, MAX_INPUT_CHARS),
  );
}

function normalizeInput(value: string): string {
  return value.trim().slice(0, MAX_INPUT_CHARS);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const cfg = getEmbeddingConfig();
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new LlmConfigError("Embedding 未配置：请配置 EMBEDDING_BASE_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL");
  }
  const output: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
    const input = texts.slice(offset, offset + BATCH_SIZE).map(normalizeInput);
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, input }),
      signal: AbortSignal.timeout(Number(process.env.EMBEDDING_TIMEOUT_MS) || 60000),
    }).catch((e) => {
      throw new LlmRequestError(`Embedding 网络错误: ${e?.message ?? e}`, true);
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LlmRequestError(
        formatLlmHttpError(res.status, text, res.headers?.get("content-type") ?? ""),
        res.status === 429 || res.status >= 500,
      );
    }
    const data = await res.json().catch(() => null) as { data?: { index?: number; embedding?: unknown }[] } | null;
    if (!data?.data || data.data.length !== input.length) {
      throw new LlmRequestError("Embedding 响应数量与输入不一致", true);
    }
    const batch = [...data.data]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((row) => row.embedding);
    if (batch.some((v) => !Array.isArray(v) || v.length === 0 || v.some((n) => typeof n !== "number" || !Number.isFinite(n)))) {
      throw new LlmRequestError("Embedding 响应包含无效向量", false);
    }
    output.push(...(batch as number[][]));
  }
  return output;
}

export async function embedText(text: string): Promise<number[]> {
  return (await embedTexts([text]))[0];
}

export async function testEmbeddingConnection(): Promise<{ ok: boolean; message: string; dimension?: number }> {
  try {
    const vector = await embedText("知了 embedding 连通性测试");
    return { ok: true, message: `Embedding 连通成功，维度 ${vector.length}`, dimension: vector.length };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
