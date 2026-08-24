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
