import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function createProxyUpstream({ heartbeatIntervalMs = 60000, heartbeatDurationMs = 360000 } = {}) {
  const server = http.createServer((req, res) => {
    const route = new URL(req.url, "http://fixture").pathname;
    if (route === "/health") { res.writeHead(200).end("ok"); return; }
    if (route === "/silent") return;
    if (route === "/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write('data: {"delta":"start"}\n\n');
      return;
    }
    if (route === "/heartbeat") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const started = Date.now();
      const timer = setInterval(() => {
        res.write('data: {"heartbeat":true}\n\n');
        if (Date.now() - started >= heartbeatDurationMs) {
          clearInterval(timer);
          res.end('data: {"done":true}\n\n');
        }
      }, heartbeatIntervalMs);
      // GET 请求已读完不代表响应已结束；只能随响应连接关闭释放心跳。
      res.on("close", () => clearInterval(timer));
      return;
    }
    if (route === "/upload") { req.pause(); return; }
    res.writeHead(404).end("not found");
  });
  // 专用夹具不能让 Node 自带的 300 秒请求时限抢先终止 Nginx 发送场景。
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DEMO_PROXY_UPSTREAM_PORT ?? 3000);
  createProxyUpstream().listen(port, "0.0.0.0", () => console.log(JSON.stringify({ ready: true, port })));
}
