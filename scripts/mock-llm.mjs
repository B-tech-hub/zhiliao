// 本地 Mock LLM：OpenAI 兼容 /v1/chat/completions，用于验证 AI 流水线机制
// 规则（按笔记内容触发）：
//   FAIL500  -> 返回 500（测退避重试与最终 failed）
//   BADJSON  -> 返回非法 JSON（测反馈式重试，两次后仍非法 -> failed）
//   MYSTERY  -> confidence 0.3（测低置信度归未分类）
//   含"球"   -> 归入"羽毛球"，conf 0.9
//   含"视频/选题" -> 归入"自媒体"，conf 0.85
//   其他     -> inbox conf 0.4
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

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const user = payload.messages?.findLast?.((m) => m.role === "user")?.content ?? "";
    let out;
    if (user.includes("未分类笔记概要")) out = handleSuggest(user);
    else if (user.includes("现有主题列表")) out = handleNoteProcess(user);
    else out = { status: 200, json: { pong: true } };

    if (out.status !== 200) {
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body ?? {}));
      return;
    }
    const content = out.text ?? JSON.stringify(out.json);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
    console.log("[mock-llm]", user.includes("未分类笔记概要") ? "suggest" : "process", "->", content.slice(0, 80));
  });
});

server.listen(8787, () => console.log("mock LLM 已启动 http://localhost:8787/v1"));
