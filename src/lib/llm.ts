// LLM 抽象层：OpenAI 兼容 Chat Completions 格式。
// 配置读取 DB 优先、环境变量兜底（见 llm-config.ts）；LLM_TIMEOUT_MS 仅走环境变量。

import { getLlmConfig } from "@/lib/llm-config";

export class LlmConfigError extends Error {}
export class LlmRequestError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// 多模态消息内容片段（OpenAI 兼容格式），供视觉模型使用
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface MultiModalChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

// 流式对话：SSE 逐 delta 产出文本。可传入独立端点配置（如视觉模型），缺省用文本模型配置。
export async function* chatStream(
  msgs: MultiModalChatMessage[],
  opts?: { baseUrl?: string | null; apiKey?: string | null; model?: string | null; signal?: AbortSignal },
): AsyncGenerator<string> {
  const fallback = getLlmConfig();
  const baseUrl = opts?.baseUrl ?? fallback.baseUrl;
  const apiKey = opts?.apiKey ?? fallback.apiKey;
  const model = opts?.model ?? fallback.model;
  if (!baseUrl || !apiKey || !model) {
    throw new LlmConfigError("LLM 未配置：请在设置页或环境变量中配置接入点 / API Key / 模型");
  }
  const timeout = Number(process.env.LLM_TIMEOUT_MS) || 120000;
  const signals = [AbortSignal.timeout(timeout), ...(opts?.signal ? [opts.signal] : [])];

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: msgs, temperature: 0.5, stream: true }),
    signal: AbortSignal.any(signals),
  }).catch((e) => {
    throw new LlmRequestError(`网络错误: ${e?.message ?? e}`, true);
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    throw new LlmRequestError(`LLM 请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`, retryable);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        } catch {
          // 忽略无法解析的心跳/注释行
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function isLlmConfigured(): boolean {
  const c = getLlmConfig();
  return Boolean(c.baseUrl && c.apiKey && c.model);
}

// 是否已探测到当前供应商不支持 response_format（进程内缓存）
let jsonModeUnsupported = false;

async function chatOnce(messages: ChatMessage[], useJsonMode: boolean): Promise<string> {
  const { baseUrl, apiKey, model } = getLlmConfig();
  if (!baseUrl || !apiKey || !model) {
    throw new LlmConfigError("LLM 未配置：请在设置页或环境变量中配置接入点 / API Key / 模型");
  }
  const timeout = Number(process.env.LLM_TIMEOUT_MS) || 60000;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2,
  };
  if (useJsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  }).catch((e) => {
    throw new LlmRequestError(`网络错误: ${e?.message ?? e}`, true);
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 401/403 为配置错误不重试；429/5xx 可重试；response_format 不支持时由上层降级
    if (res.status === 400 && useJsonMode && /response_format/i.test(text)) {
      jsonModeUnsupported = true;
      return chatOnce(messages, false);
    }
    const retryable = res.status === 429 || res.status >= 500;
    throw new LlmRequestError(`LLM 请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`, retryable);
  }

  const data = await res.json().catch(() => {
    throw new LlmRequestError("LLM 响应不是合法 JSON", true);
  });
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) {
    throw new LlmRequestError("LLM 响应缺少内容", true);
  }
  return content;
}

// 剥掉可能的 ```json 围栏
export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : trimmed;
}

// 请求一次并解析为 JSON 对象；解析失败带错误反馈追加一轮重试
export async function chatJson(messages: ChatMessage[]): Promise<unknown> {
  const first = await chatOnce(messages, !jsonModeUnsupported);
  try {
    return JSON.parse(stripJsonFence(first));
  } catch {
    const retryMessages: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: first },
      {
        role: "user",
        content: "你上一次的输出不是合法 JSON。请严格只输出 JSON 对象本身，不要包含任何解释文字或代码块围栏。",
      },
    ];
    const second = await chatOnce(retryMessages, !jsonModeUnsupported);
    try {
      return JSON.parse(stripJsonFence(second));
    } catch {
      throw new LlmRequestError("LLM 连续两次输出非法 JSON", false);
    }
  }
}

// 连通性测试：让模型输出一个最小 JSON
export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    await chatJson([
      { role: "system", content: "只输出 JSON。" },
      { role: "user", content: '输出 {"pong":true}' },
    ]);
    return { ok: true, message: `连接成功（${getLlmConfig().model}）` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
