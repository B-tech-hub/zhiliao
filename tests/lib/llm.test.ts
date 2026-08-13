import { afterEach, describe, expect, it, vi } from "vitest";

// llm.ts 内有 jsonModeUnsupported 模块级状态（response_format 降级探测），
// 每个用例重置模块后动态导入，避免用例间状态污染
async function freshLlm() {
  vi.resetModules();
  return await import("@/lib/llm");
}

// 构造 OpenAI 兼容响应
function llmResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { role: "assistant", content } }] }),
    text: async () => "",
  };
}

function requestBody(call: unknown[]): Record<string, unknown> {
  const init = call[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("llm", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stripJsonFence 剥掉可能的代码块围栏", async () => {
    const { stripJsonFence } = await freshLlm();
    expect(stripJsonFence('{"a":1}')).toBe('{"a":1}');
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("chatJson 解析首次合法输出", async () => {
    const { chatJson } = await freshLlm();
    const fetchMock = vi.fn(async () => llmResponse('{"pong":true}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson([{ role: "user", content: "ping" }])).resolves.toEqual({ pong: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("首次输出非法 JSON 时带错误反馈重试一次", async () => {
    const { chatJson } = await freshLlm();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(llmResponse("我拒绝输出结构化数据"))
      .mockResolvedValueOnce(llmResponse('{"ok":1}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson([{ role: "user", content: "hi" }])).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const messages = requestBody(fetchMock.mock.calls[1]).messages as { content: string }[];
    expect(messages.at(-1)?.content).toContain("不是合法 JSON");
  });

  it("连续两次非法 JSON 判为不可重试失败", async () => {
    const { chatJson, LlmRequestError } = await freshLlm();
    vi.stubGlobal("fetch", vi.fn(async () => llmResponse("依旧不是 JSON")));
    const err = await chatJson([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmRequestError);
    expect((err as InstanceType<typeof LlmRequestError>).retryable).toBe(false);
  });

  it("供应商不支持 response_format 时自动降级重发并记忆状态", async () => {
    const { chatJson } = await freshLlm();
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.response_format) {
        return { ok: false, status: 400, text: async () => "response_format is not supported", json: async () => ({}) };
      }
      return llmResponse('{"ok":true}');
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatJson([{ role: "user", content: "hi" }])).resolves.toEqual({ ok: true });
    // 第 1 次带 response_format 被拒，第 2 次降级成功
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 降级状态被记忆：后续请求直接不带 response_format
    await chatJson([{ role: "user", content: "hi" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestBody(fetchMock.mock.calls[2]).response_format).toBeUndefined();
  });

  it("HTTP 429/5xx 为可重试错误，401 为不可重试", async () => {
    const { chatJson, LlmRequestError } = await freshLlm();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 429, text: async () => "rate limited", json: async () => ({}) })),
    );
    const err429 = await chatJson([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect(err429).toBeInstanceOf(LlmRequestError);
    expect((err429 as InstanceType<typeof LlmRequestError>).retryable).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, text: async () => "bad key", json: async () => ({}) })),
    );
    const err401 = await chatJson([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect((err401 as InstanceType<typeof LlmRequestError>).retryable).toBe(false);
  });

  it("LLM 未配置时抛配置错误", async () => {
    const saved = {
      url: process.env.LLM_BASE_URL,
      key: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL,
    };
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    try {
      const { chatJson, LlmConfigError } = await freshLlm();
      const err = await chatJson([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LlmConfigError);
    } finally {
      process.env.LLM_BASE_URL = saved.url;
      process.env.LLM_API_KEY = saved.key;
      process.env.LLM_MODEL = saved.model;
    }
  });
});
