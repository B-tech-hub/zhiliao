// LLM 抽象层：OpenAI 兼容 Chat Completions 格式。
// 配置读取 DB 优先、环境变量兜底（见 llm-config.ts）；LLM_TIMEOUT_MS 仅走环境变量。

import { getLlmConfig, getVisionConfig } from "@/lib/llm-config";

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

// 工具定义（OpenAI function calling 格式）
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallPart {
  id: string;
  name: string;
  // 原始 JSON 字符串，由调用方负责解析与校验
  args: string;
}

// 流式产出：文本增量逐个到达，工具调用累积完整后在流末尾一次性给出
export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCallPart };

interface DeltaToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamDelta {
  content?: string;
  tool_calls?: DeltaToolCall[];
}

/* SSE 解析：与网络层解耦，便于直接喂字符串做单测。
   工具调用在流中是分片到达的——同一次调用的 arguments 会被切成多个 chunk，
   且多个并发调用靠 index 区分，必须累积到流末尾才完整。 */
export async function* parseSseStream(
  source: AsyncIterable<string>,
): AsyncGenerator<StreamChunk> {
  const pending = new Map<number, ToolCallPart>();
  let buffer = "";

  outer: for await (const piece of source) {
    buffer += piece;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") break outer;

      let delta: StreamDelta | undefined;
      try {
        delta = (JSON.parse(payload) as { choices?: { delta?: StreamDelta }[] })?.choices?.[0]
          ?.delta;
      } catch {
        continue; // 忽略无法解析的心跳/注释行
      }

      if (typeof delta?.content === "string" && delta.content) {
        yield { type: "text", text: delta.content };
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          // index 缺省视为 0：部分供应商单工具调用时不带 index
          const idx = typeof tc.index === "number" ? tc.index : 0;
          const cur = pending.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (typeof tc.function?.arguments === "string") cur.args += tc.function.arguments;
          pending.set(idx, cur);
        }
      }
    }
  }

  // 按 index 升序给出，保证工具执行顺序与模型意图一致；没拿到名字的丢弃
  for (const [, call] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
    if (call.name) yield { type: "tool_call", call };
  }
}

// 字节流转文本片段流
async function* decodeStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

// 流式对话：产出文本增量与工具调用。可传入独立端点配置（如视觉模型），缺省用文本模型配置。
export async function* chatStream(
  msgs: MultiModalChatMessage[],
  opts?: {
    baseUrl?: string | null;
    apiKey?: string | null;
    model?: string | null;
    signal?: AbortSignal;
    tools?: ToolDef[];
  },
): AsyncGenerator<StreamChunk> {
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
    body: JSON.stringify({
      model,
      messages: msgs,
      temperature: 0.5,
      stream: true,
      // 无工具时不发 tools 字段：避免不支持的供应商直接 400
      ...(opts?.tools?.length ? { tools: opts.tools } : {}),
    }),
    signal: AbortSignal.any(signals),
  }).catch((e) => {
    throw new LlmRequestError(`网络错误: ${e?.message ?? e}`, true);
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    throw new LlmRequestError(`LLM 请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`, retryable);
  }

  yield* parseSseStream(decodeStream(res.body));
}

export function isLlmConfigured(): boolean {
  const c = getLlmConfig();
  return Boolean(c.baseUrl && c.apiKey && c.model);
}

// 探测用工具：无参数，模型只要"愿意调"就说明 tools 参数被真正处理了
const PROBE_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "probe_ping",
    description: "探测用占位工具。收到指令时必须调用它，不要用文字回答。",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

/* 工具调用能力探测。三种失败模式都判为不支持，其中最危险的是"静默忽略"——
   供应商不报错、直接丢掉 tools 参数返回文本，助手会声称"已帮你创建笔记"
   但实际什么都没发生。所以判据是"有没有真的收到 tool_call"，而非"有没有报错"。 */
export async function probeToolSupport(): Promise<{ supported: boolean; message: string }> {
  try {
    let sawToolCall = false;
    let text = "";
    for await (const chunk of chatStream(
      [{ role: "user", content: "请调用 probe_ping 工具，不要用文字回答。" }],
      { tools: [PROBE_TOOL], signal: AbortSignal.timeout(60000) },
    )) {
      if (chunk.type === "tool_call") sawToolCall = true;
      else text += chunk.text;
    }
    if (sawToolCall) return { supported: true, message: "支持工具调用" };
    const tail = text.trim() ? `，只回了文字「${text.trim().slice(0, 20)}」` : "";
    return { supported: false, message: `不支持工具调用（模型忽略了 tools 参数${tail}）` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 供应商明确拒绝 tools 参数（通常是 400）
    if (/tool|function/i.test(msg)) {
      return { supported: false, message: `不支持工具调用：${msg.slice(0, 120)}` };
    }
    return { supported: false, message: `工具调用探测失败：${msg.slice(0, 120)}` };
  }
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

// 1×1 像素 PNG，仅用于探测端点是否接受多模态消息，不校验模型答了什么
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// 视觉模型连通性测试：走视觉配置发一条带图消息，验证多模态链路可用
export async function testVisionConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = getVisionConfig();
  if (!cfg.model) {
    return { ok: false, message: "未配置视觉模型名，AI 读图未启用" };
  }
  if (!cfg.baseUrl || !cfg.apiKey) {
    return { ok: false, message: "缺少接入点或 API Key：请填写，或先配置好上方文本模型以便回落" };
  }
  try {
    let text = "";
    for await (const chunk of chatStream(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "用一个词描述这张图片。" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${ONE_PIXEL_PNG}` } },
          ],
        },
      ],
      {
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        signal: AbortSignal.timeout(30000),
      },
    )) {
      if (chunk.type === "text") text += chunk.text;
    }
    if (!text.trim()) {
      return { ok: false, message: "视觉模型无响应内容（端点可能未按 OpenAI 多模态格式返回）" };
    }
    return { ok: true, message: `连接成功（${cfg.model}）` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
