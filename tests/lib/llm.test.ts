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

  it("上游返回网站防火墙 HTML 时不把整段页面暴露给界面", async () => {
    const { formatLlmHttpError } = await freshLlm();
    const html = '<!doctype html><html><head><title>网站防火墙</title></head></html>';
    const message = formatLlmHttpError(403, html, "text/html; charset=utf-8");
    expect(message).toContain("HTTP 403");
    expect(message).toContain("网站防火墙");
    expect(message).not.toContain("<!doctype");
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

/* 工具调用在流中是分片到达的：同一次调用的 arguments 被切成多个 chunk，
   多个并发调用靠 index 区分。这里直接喂字符串，绕开网络层。 */
describe("parseSseStream", () => {
  async function* feed(...pieces: string[]) {
    for (const p of pieces) yield p;
  }

  async function collect(...pieces: string[]) {
    const { parseSseStream } = await freshLlm();
    const out = [];
    for await (const chunk of parseSseStream(feed(...pieces))) out.push(chunk);
    return out;
  }

  const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
  const textDelta = (t: string) => sse({ choices: [{ delta: { content: t } }] });
  const toolDelta = (...calls: unknown[]) => sse({ choices: [{ delta: { tool_calls: calls } }] });
  const DONE = "data: [DONE]\n\n";

  it("文本增量按序产出", async () => {
    expect(await collect(textDelta("你"), textDelta("好"), DONE)).toEqual([
      { type: "text", text: "你" },
      { type: "text", text: "好" },
    ]);
  });

  it("单个工具调用的 arguments 分片被拼回完整 JSON", async () => {
    const out = await collect(
      toolDelta({ index: 0, id: "call_1", function: { name: "search_notes", arguments: "" } }),
      toolDelta({ index: 0, function: { arguments: '{"query":' } }),
      toolDelta({ index: 0, function: { arguments: '"跑步"}' } }),
      DONE,
    );
    expect(out).toEqual([
      { type: "tool_call", call: { id: "call_1", name: "search_notes", args: '{"query":"跑步"}' } },
    ]);
  });

  it("多个并发工具调用按 index 归组，且按 index 升序产出", async () => {
    const out = await collect(
      // 故意让 index 1 先到，验证输出顺序由 index 决定而非到达顺序
      toolDelta({ index: 1, id: "call_b", function: { name: "read_note", arguments: '{"id"' } }),
      toolDelta({ index: 0, id: "call_a", function: { name: "list_topics", arguments: "{" } }),
      toolDelta({ index: 1, function: { arguments: ':"n1"}' } }, { index: 0, function: { arguments: "}" } }),
      DONE,
    );
    expect(out).toEqual([
      { type: "tool_call", call: { id: "call_a", name: "list_topics", args: "{}" } },
      { type: "tool_call", call: { id: "call_b", name: "read_note", args: '{"id":"n1"}' } },
    ]);
  });

  it("文本与工具调用混合时，文本即时产出、工具调用在末尾", async () => {
    const out = await collect(
      textDelta("我来查一下"),
      toolDelta({ index: 0, id: "c1", function: { name: "search_notes", arguments: "{}" } }),
      textDelta("稍等"),
      DONE,
    );
    expect(out).toEqual([
      { type: "text", text: "我来查一下" },
      { type: "text", text: "稍等" },
      { type: "tool_call", call: { id: "c1", name: "search_notes", args: "{}" } },
    ]);
  });

  it("SSE 事件被网络分片从中间切断也能正确解析", async () => {
    const line = textDelta("hello");
    const cut = Math.floor(line.length / 2);
    expect(await collect(line.slice(0, cut), line.slice(cut), DONE)).toEqual([
      { type: "text", text: "hello" },
    ]);
  });

  it("index 缺省视为 0（部分供应商单工具调用不带 index）", async () => {
    const out = await collect(
      toolDelta({ id: "c1", function: { name: "create_note", arguments: '{"a":1}' } }),
      DONE,
    );
    expect(out).toEqual([
      { type: "tool_call", call: { id: "c1", name: "create_note", args: '{"a":1}' } },
    ]);
  });

  it("未发 [DONE] 直接断流时，已累积的工具调用仍被产出", async () => {
    const out = await collect(
      toolDelta({ index: 0, id: "c1", function: { name: "list_topics", arguments: "{}" } }),
    );
    expect(out).toEqual([
      { type: "tool_call", call: { id: "c1", name: "list_topics", args: "{}" } },
    ]);
  });

  it("忽略心跳与非法 JSON 行，不影响后续解析", async () => {
    const out = await collect(": keep-alive\n\n", "data: {坏JSON\n\n", textDelta("ok"), DONE);
    expect(out).toEqual([{ type: "text", text: "ok" }]);
  });

  it("只有 arguments 没有函数名的残缺调用被丢弃", async () => {
    const out = await collect(toolDelta({ index: 0, function: { arguments: '{"a":1}' } }), DONE);
    expect(out).toEqual([]);
  });

  /* 深度思考的思考过程。三种线格式都要认，认不出就等于功能不存在——
     原先只解析 content，reasoning_content 在这一层被静默丢弃。 */
  describe("思考过程", () => {
    const traceDelta = (t: string) => sse({ choices: [{ delta: { reasoning_content: t } }] });
    const orDelta = (t: string) => sse({ choices: [{ delta: { reasoning: t } }] });
    const join = (out: { type: string; text?: string }[], type: string) =>
      out.filter((c) => c.type === type).map((c) => c.text).join("");

    it("reasoning_content 字段产出 reasoning 块", async () => {
      expect(await collect(traceDelta("先想想"), textDelta("答案"), DONE)).toEqual([
        { type: "reasoning", text: "先想想" },
        { type: "text", text: "答案" },
      ]);
    });

    it("OpenRouter 的 reasoning 字段同样认", async () => {
      expect(await collect(orDelta("嗯"), DONE)).toEqual([{ type: "reasoning", text: "嗯" }]);
    });

    it("内联 <think> 标签被剥离成 reasoning", async () => {
      expect(await collect(textDelta("<think>推演</think>结论"), DONE)).toEqual([
        { type: "reasoning", text: "推演" },
        { type: "text", text: "结论" },
      ]);
    });

    /* 标签会跨 chunk 断开。不留住尾巴的话，用户会在答案里看到裸的「<thi」，
       而后半段思考过程被当成正文吐出来。 */
    it("跨 chunk 断开的标签不吐半截", async () => {
      const out = await collect(
        textDelta("<thi"),
        textDelta("nk>推演</thi"),
        textDelta("nk>结论"),
        DONE,
      );
      expect(join(out, "text")).toBe("结论");
      expect(join(out, "reasoning")).toBe("推演");
    });

    // 流在思考中途断掉：已收到的部分不能凭空消失
    it("未闭合的 think 在流末尾被冲出", async () => {
      const out = await collect(textDelta("<think>想到一半"), DONE);
      expect(out).toEqual([{ type: "reasoning", text: "想到一半" }]);
    });

    // 不带标签的普通回答不该受剥离器影响
    it("无标签文本原样通过", async () => {
      expect(await collect(textDelta("普通"), textDelta("回答"), DONE)).toEqual([
        { type: "text", text: "普通" },
        { type: "text", text: "回答" },
      ]);
    });
  });
});
