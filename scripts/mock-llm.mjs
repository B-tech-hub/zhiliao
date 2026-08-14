// 本地 Mock LLM：OpenAI 兼容 /v1/chat/completions，用于验证 AI 流水线机制
// 规则（按笔记内容触发）：
//   FAIL500  -> 返回 500（测退避重试与最终 failed）
//   BADJSON  -> 返回非法 JSON（测反馈式重试，两次后仍非法 -> failed）
//   MYSTERY  -> confidence 0.3（测低置信度归未分类）
//   含"球"   -> 归入"羽毛球"，conf 0.9
//   含"视频/选题" -> 归入"自媒体"，conf 0.85
//   其他     -> inbox conf 0.4
// 请求含 stream:true 时按 SSE 分片返回 delta（AI 对话与视觉测试走流式，非流式会读不到任何内容）
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
