import http, { type RequestListener, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { readChatStream, verifyDemoHttp, verifyDemoSse } from "../../scripts/demo-http-probes.mjs";

const servers = new Set<http.Server>();
const limits = { firstDeltaTimeoutMs: 1000, idleTimeoutMs: 1000, totalTimeoutMs: 3000 };
const frame = (event: object) => "data: " + JSON.stringify(event) + "\n\n";

async function listen(handler: RequestListener) {
  const server = http.createServer(handler);
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试端口不可用");
  return "http://127.0.0.1:" + address.port;
}

function stream(res: ServerResponse, events: object[], { end = true, interval = 30 } = {}) {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
  res.flushHeaders();
  let index = 0;
  const send = () => {
    if (index === events.length) {
      clearInterval(timer);
      if (end) res.end();
      return;
    }
    res.write(frame(events[index++]));
  };
  const timer = setInterval(send, interval);
  res.on("close", () => clearInterval(timer));
  send();
}

afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  servers.clear();
});

describe("Demo HTTP 和 SSE 探针（仅本机临时 HTTP 夹具）", () => {
  it("用不同长度区分默认 8m、导入 200m 和上传 25m", async () => {
    const received: Record<string, number> = {};
    const base = await listen((req, res) => {
      if (req.method === "GET" && req.url === "/api/healthz") { res.writeHead(200).end("ok"); return; }
      const length = Number(req.headers["content-length"]);
      const path = req.url ?? "";
      req.once("data", (chunk) => {
        received[path] = (received[path] ?? 0) + chunk.length;
        const overDefault = length > 8 * 1024 * 1024;
        const overUpload = length > 25 * 1024 * 1024;
        const overImport = length > 200 * 1024 * 1024;
        if (path === "/api/notes" && overDefault) { res.writeHead(413).end(); return; }
        if (path === "/api/uploads" && overUpload) { res.writeHead(413).end(); return; }
        if (path === "/api/import" && overImport) { res.writeHead(413).end(); return; }
        res.writeHead(401).end();
      });
    });
    await expect(verifyDemoHttp(base, { timeoutMs: 1000 })).resolves.toMatchObject({
      health: 200, oversize: 413, default_oversize: 413, upload_oversize: 413,
      import_midsize: 401, upload_midsize: 401, sent_body_bytes: 1,
    });
    expect(Object.values(received).every((value) => value === 1)).toBe(true);
  });

  it.each([["health", 503], ["oversize", 200]] as const)("拒绝 %s 的错误状态", async (kind, status) => {
    const base = await listen((req, res) => {
      res.writeHead(req.url === "/api/healthz" ? (kind === "health" ? status : 200) : status).end();
    });
    await expect(verifyDemoHttp(base, { timeoutMs: 1000 })).rejects.toThrow(kind === "health" ? "健康检查" : "默认入口超限");
  });

  it("登录后验证正文分批到达、done 结束、主动中断和中断后的健康检查", async () => {
    let chats = 0;
    const base = await listen((req, res) => {
      req.resume();
      if (req.url === "/api/auth/login") {
        res.writeHead(200, { "Set-Cookie": "kb_session=fixture-only; Path=/; Secure; HttpOnly" }).end();
      } else if (req.url === "/api/healthz") {
        res.writeHead(200).end();
      } else {
        expect(req.url).toBe("/api/chat");
        expect(req.headers.cookie).toBe("kb_session=fixture-only");
        chats += 1;
        stream(res, [{ delta: "第一段" }, { delta: "第二段" }, { done: true }]);
      }
    });
    await expect(verifyDemoSse(base, "fixture-password", limits)).resolves.toMatchObject({
      completed: { done: true, cancelled: false, delta_count: 2, delta_batches: 2 },
      cancellation: { cancelled: true, delta_count: 1 },
      health_after_cancel: 200,
    });
    expect(chats).toBe(2);
  });

  it("健康请求没有响应时在总时限内失败", async () => {
    const base = await listen((req) => req.resume());
    await expect(verifyDemoHttp(base, { timeoutMs: 50 })).rejects.toThrow("HTTP 检查超时");
  });

  it("只有 SSE 响应头而没有正文时触发首块超时", async () => {
    const base = await listen((req, res) => {
      req.resume();
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
    });
    await expect(readChatStream(base, "kb_session=fixture", { ...limits, firstDeltaTimeoutMs: 50 })).rejects.toThrow("首个正文事件超时");
  });

  it("已收到正文后停滞的流触发空闲超时", async () => {
    const base = await listen((req, res) => {
      req.resume();
      stream(res, [{ delta: "开始" }], { end: false });
    });
    await expect(readChatStream(base, "kb_session=fixture", { ...limits, idleTimeoutMs: 80 })).rejects.toThrow("空闲超时");
  });

  it("持续发送事件但不结束的流仍受总时限限制", async () => {
    const base = await listen((req, res) => {
      req.resume();
      stream(res, Array.from({ length: 100 }, () => ({ delta: "继续" })), { interval: 15 });
    });
    await expect(readChatStream(base, "kb_session=fixture", { ...limits, totalTimeoutMs: 100 })).rejects.toThrow("总时限");
  });

  it("一次性缓冲全部事件不能被认作流式通过", async () => {
    const base = await listen((req, res) => {
      req.resume();
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end([{ delta: "第一段" }, { delta: "第二段" }, { done: true }].map(frame).join(""));
    });
    await expect(readChatStream(base, "kb_session=fixture", limits)).rejects.toThrow("未分批到达");
  });

  it("缺少应用协议的 done 事件时失败", async () => {
    const base = await listen((req, res) => {
      req.resume();
      stream(res, [{ delta: "第一段" }, { delta: "第二段" }]);
    });
    await expect(readChatStream(base, "kb_session=fixture", limits)).rejects.toThrow("缺少 done");
  });

  it("应用返回错误事件时不回显其中的敏感文本", async () => {
    const base = await listen((req, res) => {
      req.resume();
      stream(res, [{ error: "fixture-sensitive-value" }]);
    });
    await expect(readChatStream(base, "kb_session=fixture", limits)).rejects.toThrow("返回错误");
  });

  it("HTML 响应不能被当成 SSE 通过", async () => {
    const base = await listen((req, res) => {
      req.resume();
      res.writeHead(200, { "Content-Type": "text/html" }).end("login");
    });
    await expect(readChatStream(base, "kb_session=fixture", limits)).rejects.toThrow("text/event-stream");
  });
});
