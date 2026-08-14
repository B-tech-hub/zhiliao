// 本地 Mock LLM：OpenAI 兼容 /v1/chat/completions，用于验证 AI 流水线机制
// 规则（按笔记内容触发）：
//   FAIL500  -> 返回 500（测退避重试与最终 failed）
//   BADJSON  -> 返回非法 JSON（测反馈式重试，两次后仍非法 -> failed）
//   MYSTERY  -> confidence 0.3（测低置信度归未分类）
//   含"球"   -> 归入"羽毛球"，conf 0.9
//   含"视频/选题" -> 归入"自媒体"，conf 0.85
//   其他     -> inbox conf 0.4
// 请求含 stream:true 时按 SSE 分片返回 delta（AI 对话与视觉测试走流式，非流式会读不到任何内容）
// 请求含 tools 时返回工具调用；arguments 故意切成多片发送，用于验证客户端的分片合并
// 同一轮只调一次工具：消息里出现 role:"tool" 后改回文本，模拟"拿到结果就总结"
// 环境变量 MOCK_IGNORE_TOOLS=1 -> 收到 tools 也当没看见，模拟"静默忽略工具参数"的劣质供应商
import http from "node:http";

function pickTopic(topics, content) {
  const find = (name) => topics.find((t) => t.name === name)?.id;
  if (/球/.test(content)) return { topicId: find("羽毛球") ?? "inbox", confidence: 0.9 };
  if (/视频|选题/.test(content)) return { topicId: find("自媒体") ?? "inbox", confidence: 0.85 };
  return { topicId: "inbox", confidence: 0.4 };
}

function handleNoteProcess(user) {
  const topicsJson = user.match(/不能新建）\n(\[.*?\])\n/s)?.[1] ?? "[]";
  const topics = JSON.parse(topicsJson);
  const content = user.match(/## 笔记内容（Markdown）\n([\s\S]*?)\n\n## 任务要求/)?.[1] ?? "";

  if (content.includes("FAIL500")) return { status: 500, body: { error: { message: "mock 内部错误" } } };
  if (content.includes("BADJSON")) {
    return { status: 200, text: "这不是 JSON，我拒绝输出结构化数据。" };
  }
  const { topicId, confidence } = content.includes("MYSTERY")
    ? { topicId: "inbox", confidence: 0.3 }
    : pickTopic(topics, content);

  const result = {
    topicId,
    confidence,
    title: content.replace(/[#\n]/g, "").trim().slice(0, 10) + "·AI",
    tags: /球/.test(content) ? ["羽毛球", "训练"] : ["测试", "记录"],
    summary: content.length >= 200 ? "这是 mock 生成的一句话摘要" : null,
  };
  return { status: 200, json: result };
}

function handleSuggest(user) {
  const digestJson = user.match(/## 未分类笔记概要\n(\[.*?\])\n/s)?.[1] ?? "[]";
  const digest = JSON.parse(digestJson);
  const runIds = digest.filter((d) => /跑/.test(d.excerpt)).map((d) => d.id);
  const cookIds = digest.filter((d) => /菜|做饭|厨/.test(d.excerpt)).map((d) => d.id);
  const suggestions = [];
  if (runIds.length >= 3)
    suggestions.push({ name: "跑步", reason: "多条笔记记录跑步训练", noteIds: runIds, existingTopicId: null });
  if (cookIds.length >= 3)
    suggestions.push({ name: "下厨", reason: "多条笔记与做饭相关", noteIds: cookIds, existingTopicId: null });
  return { status: 200, json: { suggestions } };
}

// 消息内容可能是字符串，也可能是多模态数组，统一取出其中的文本部分
function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
  }
  return "";
}

function hasImagePart(content) {
  return Array.isArray(content) && content.some((p) => p?.type === "image_url");
}

// AI 对话的模拟回复：从 system prompt 里认出当前上下文，回一段像样的话
function handleChat(system, question, withImage) {
  if (withImage) {
    return "我看到了这张图片。这是体验模式下的 mock 回复，真实的读图效果取决于你在设置页配置的视觉模型。";
  }
  const title = system.match(/\n# (.+)/)?.[1] ?? system.match(/主题：(.+)/)?.[1] ?? "当前内容";
  return [
    `关于「${title}」，你问的是：${question.slice(0, 30)}`,
    "",
    "这是体验模式下的 mock 回复，按固定模板生成，不代表真实模型能力。",
    "在「设置 → AI 服务」配置真实的 LLM 后，这里会变成基于笔记内容的实际回答。",
  ].join("\n");
}

// SSE 流式：把整段内容切片按 OpenAI delta 格式发出，末尾补 [DONE]
function sendStream(res, content) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const chunks = content.match(/[\s\S]{1,12}/g) ?? [];
  let i = 0;
  const timer = setInterval(() => {
    if (i >= chunks.length) {
      clearInterval(timer);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] })}\n\n`);
    i += 1;
  }, 15);
  // 客户端提前断开（用户点"停止"）后别再往已关闭的响应里写
  res.on("close", () => clearInterval(timer));
}

// 工具调用模拟：优先挑 user 消息里点名的工具，没点名就按意图猜
function pickTool(tools, user) {
  const named = tools.find((t) => t?.function?.name && user.includes(t.function.name));
  if (named) return named;
  const has = (name) => tools.find((t) => t?.function?.name === name);
  if (/https?:\/\//.test(user)) return has("fetch_url") ?? tools[0];
  if (/删/.test(user)) return has("delete_note") ?? tools[0];
  if (/记一条|记录|新建|写一条/.test(user)) return has("create_note") ?? tools[0];
  if (/主题|分类/.test(user)) return has("list_topics") ?? tools[0];
  return has("search_notes") ?? tools[0];
}

/* 按工具名生成能通过 zod 校验的参数。
   这不是锦上添花——助手的循环拿到「参数不合法」会把错误回灌给模型让它重试，
   若 mock 恒发 {}，写工具永远失败，循环会一路空转到 8 轮上限才停。 */
function mockArgs(name, user) {
  const noteId = user.match(/\b[a-z0-9]{20,32}\b/)?.[0] ?? "mock-note-id";
  switch (name) {
    case "create_note":
      return JSON.stringify({ content: user.slice(0, 200) || "来自 mock 的笔记" });
    case "append_to_note":
      return JSON.stringify({ noteId, text: "mock 追加的一段" });
    case "update_meta":
      return JSON.stringify({ noteId, title: "mock 改的标题" });
    case "delete_note":
    case "read_note":
      return JSON.stringify({ noteId });
    case "search_notes":
      return JSON.stringify({ query: user.replace(/[^一-龥a-zA-Z0-9]/g, "").slice(0, 8) || "笔记" });
    case "fetch_url":
      return JSON.stringify({ url: user.match(/https?:\/\/\S+/)?.[0] ?? "https://example.com" });
    default:
      return "{}";
  }
}

// 把 arguments 切成几片，模拟真实供应商的分片下发（客户端必须能拼回完整 JSON）
function splitArgs(args) {
  if (args.length <= 2) return [args];
  const mid = Math.ceil(args.length / 2);
  return [args.slice(0, mid), args.slice(mid)];
}

// 流式工具调用：首帧带 id/name，随后逐片补 arguments
function sendToolCallStream(res, name, args) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const frames = [
    { index: 0, id: "call_mock_1", type: "function", function: { name, arguments: "" } },
    ...splitArgs(args).map((piece) => ({ index: 0, function: { arguments: piece } })),
  ];
  let i = 0;
  const timer = setInterval(() => {
    if (i >= frames.length) {
      clearInterval(timer);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [frames[i]] } }] })}\n\n`);
    i += 1;
  }, 15);
  res.on("close", () => clearInterval(timer));
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const lastUser = payload.messages?.findLast?.((m) => m.role === "user");
    const user = textOf(lastUser?.content);
    const system = textOf(payload.messages?.find?.((m) => m.role === "system")?.content);
    const withImage = hasImagePart(lastUser?.content);
    const isChat = system.includes("个人知识库的 AI 助手") || withImage;

    /* 工具调用优先，但只在这一轮里调一次：消息里已经有 tool 结果时改回文本，
       模拟真实模型「拿到结果就总结」的行为。否则每轮都发新调用，
       助手的循环会一路跑到轮次上限，端到端验证永远看不到收尾文本。
       MOCK_IGNORE_TOOLS=1 时故意无视 tools 直接回文本，
       用于验证客户端能否识破"静默忽略工具参数"的供应商 */
    const tools = Array.isArray(payload.tools) ? payload.tools : [];
    const answered = payload.messages?.some?.((m) => m.role === "tool");
    if (tools.length && !answered && process.env.MOCK_IGNORE_TOOLS !== "1") {
      const name = pickTool(tools, user)?.function?.name ?? "unknown_tool";
      const args = mockArgs(name, user);
      console.log("[mock-llm]", payload.stream ? "tool_call(stream)" : "tool_call", "->", name, args);
      if (payload.stream) {
        sendToolCallStream(res, name, args);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  { id: "call_mock_1", type: "function", function: { name, arguments: args } },
                ],
              },
            },
          ],
        }),
      );
      return;
    }

    let out;
    let kind;
    if (user.includes("未分类笔记概要")) {
      out = handleSuggest(user);
      kind = "suggest";
    } else if (user.includes("现有主题列表")) {
      out = handleNoteProcess(user);
      kind = "process";
    } else if (isChat) {
      out = { status: 200, text: handleChat(system, user, withImage) };
      kind = withImage ? "vision" : "chat";
    } else {
      out = { status: 200, json: { pong: true } };
      kind = "ping";
    }

    if (out.status !== 200) {
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body ?? {}));
      return;
    }

    const content = out.text ?? JSON.stringify(out.json);
    console.log(
      "[mock-llm]",
      payload.stream ? `${kind}(stream)` : kind,
      "->",
      content.slice(0, 60).replace(/\n/g, " "),
    );

    if (payload.stream) {
      sendStream(res, content);
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
});

server.listen(8787, () => console.log("mock LLM 已启动 http://localhost:8787/v1"));
