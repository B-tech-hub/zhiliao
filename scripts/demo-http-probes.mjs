import http from "node:http";
import { performance } from "node:perf_hooks";

export const DEFAULT_BODY_LIMIT = 8 * 1024 * 1024;
export const UPLOAD_BODY_LIMIT = 25 * 1024 * 1024;
export const MAX_DEMO_REQUEST_BYTES = 200 * 1024 * 1024;

function oversizeHeaders(bytes) {
  return { "Content-Length": String(bytes), "Content-Type": "application/octet-stream" };
}

// 用原生 HTTP 发送少量正文，才能真实验证超大长度声明的提前拒绝。
export function requestHeaders(url, { method = "GET", headers = {}, body = "", timeoutMs = 10000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("验收被中断"));
      return;
    }
    const started = performance.now();
    const req = http.request(url, { method, headers, agent: false });
    const timer = setTimeout(() => req.destroy(new Error("HTTP 检查超时")), timeoutMs);
    const onAbort = () => req.destroy(new Error("验收被中断"));
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = (error, result) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result);
    };
    req.once("error", (error) => done(error));
    req.once("response", (res) => {
      const result = { status: res.statusCode, headers: res.headers, elapsedMs: Math.round(performance.now() - started) };
      res.on("error", () => {});
      res.destroy();
      done(null, result);
    });
    req.end(body);
  });
}

export async function verifyDemoHttp(baseUrl, { timeoutMs = 10000, signal } = {}) {
  const probe = (path, bytes) => requestHeaders(new URL(path, baseUrl), {
    method: "POST", headers: oversizeHeaders(bytes), body: "x", timeoutMs, signal,
  });
  const health = await requestHeaders(new URL("/api/healthz", baseUrl), { timeoutMs, signal });
  if (health.status !== 200) throw new Error("入口健康检查应为 200，实际为 " + health.status);
  const defaultOversize = await probe("/api/notes", DEFAULT_BODY_LIMIT + 1);
  if (defaultOversize.status !== 413) throw new Error("默认入口超限应为 413，实际为 " + defaultOversize.status);
  const importMid = await probe("/api/import", DEFAULT_BODY_LIMIT + 1);
  if (importMid.status === 413) throw new Error("导入入口被 8m 默认上限误拒绝");
  const oversize = await probe("/api/import", MAX_DEMO_REQUEST_BYTES + 1);
  if (oversize.status !== 413) throw new Error("超限请求应为 413，实际为 " + oversize.status);
  const uploadMid = await probe("/api/uploads", DEFAULT_BODY_LIMIT + 1);
  if (uploadMid.status === 413) throw new Error("上传入口被 8m 默认上限误拒绝");
  const uploadOversize = await probe("/api/uploads", UPLOAD_BODY_LIMIT + 1);
  if (uploadOversize.status !== 413) throw new Error("上传超限应为 413，实际为 " + uploadOversize.status);
  return {
    health: health.status, oversize: oversize.status, default_oversize: defaultOversize.status,
    import_midsize: importMid.status, upload_oversize: uploadOversize.status, upload_midsize: uploadMid.status,
    oversize_response_ms: oversize.elapsedMs, sent_body_bytes: 1,
  };
}

export function readChatStream(url, cookie, {
  firstDeltaTimeoutMs = 5000, idleTimeoutMs = 5000, totalTimeoutMs = 30000, cancelAfterDelta = false,
} = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ scopeType: "global", message: "list_topics 流式验收" });
    const started = performance.now();
    const req = http.request(url, {
      method: "POST",
      agent: false,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Cookie: cookie },
    });
    let settled = false;
    let pending = "";
    let bytes = 0;
    let batch = 0;
    let doneBatch = null;
    let firstDeltaBatch = null;
    let lastEventAt = null;
    let idleTimer;
    const deltaBatches = new Set();
    const metrics = { first_event_ms: null, first_delta_ms: null, event_count: 0, delta_count: 0, max_event_gap_ms: 0 };

    function finish(error, cancelled = false) {
      if (settled) return;
      settled = true;
      clearTimeout(firstTimer);
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      req.destroy();
      if (error) reject(error);
      else resolve({ ...metrics, delta_batches: deltaBatches.size, duration_ms: Math.round(performance.now() - started), cancelled, done: doneBatch !== null });
    }

    const firstTimer = setTimeout(() => finish(new Error("SSE 首个正文事件超时")), firstDeltaTimeoutMs);
    const totalTimer = setTimeout(() => finish(new Error("SSE 总时限已到")), totalTimeoutMs);
    req.on("error", (error) => finish(error));
    req.on("response", (res) => {
      if (res.statusCode !== 200 || !/^text\/event-stream(?:;|$)/i.test(res.headers["content-type"] ?? "")) {
        res.destroy();
        finish(new Error("SSE 响应必须为 200 和 text/event-stream"));
        return;
      }
      res.setEncoding("utf8");
      res.on("error", (error) => finish(error));
      res.on("aborted", () => finish(new Error("SSE 连接提前中断")));
      res.on("data", (chunk) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > 1024 * 1024) { finish(new Error("SSE 验收响应超过 1 MiB")); return; }
        batch += 1;
        pending = (pending + chunk).replace(/\r\n/g, "\n");
        let boundary;
        while (!settled && (boundary = pending.indexOf("\n\n")) !== -1) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          let event;
          try { event = JSON.parse(data); } catch { finish(new Error("SSE 事件不是合法 JSON")); return; }
          if (!event || typeof event !== "object" || event.error || event.confirm_required) {
            finish(new Error("SSE 返回错误或意外的确认请求"));
            return;
          }
          const elapsed = Math.round(performance.now() - started);
          metrics.first_event_ms ??= elapsed;
          metrics.event_count += 1;
          if (lastEventAt !== null) metrics.max_event_gap_ms = Math.max(metrics.max_event_gap_ms, elapsed - lastEventAt);
          lastEventAt = elapsed;
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => finish(new Error("SSE 持续连接空闲超时")), idleTimeoutMs);
          if (typeof event.delta === "string" && event.delta.length > 0) {
            metrics.first_delta_ms ??= elapsed;
            firstDeltaBatch ??= batch;
            metrics.delta_count += 1;
            deltaBatches.add(batch);
            clearTimeout(firstTimer);
            if (cancelAfterDelta) { finish(null, true); return; }
          }
          if (event.done === true) doneBatch = batch;
        }
      });
      res.on("end", () => {
        if (settled) return;
        if (doneBatch === null) { finish(new Error("SSE 缺少 done 结束事件")); return; }
        // 多个事件被一次性送达不能证明流式生效，必须观察到不同接收批次。
        if (deltaBatches.size < 2 || doneBatch <= firstDeltaBatch) {
          finish(new Error("SSE 正文未分批到达，可能被入口缓冲"));
          return;
        }
        finish(null);
      });
    });
    req.end(body);
  });
}

export async function verifyDemoSse(baseUrl, password, options = {}) {
  const loginBody = JSON.stringify({ password });
  const login = await requestHeaders(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(loginBody) },
    body: loginBody,
    timeoutMs: options.firstDeltaTimeoutMs ?? 5000,
    signal: options.signal,
  });
  if (login.status !== 200) throw new Error("SSE 验收登录失败：" + login.status);
  const cookie = (login.headers["set-cookie"] ?? []).find((value) => value.startsWith("kb_session="))?.split(";")[0];
  if (!cookie) throw new Error("SSE 验收登录未返回会话 Cookie");
  const url = new URL("/api/chat", baseUrl);
  const completed = await readChatStream(url, cookie, options);
  const cancellation = await readChatStream(url, cookie, { ...options, cancelAfterDelta: true });
  const health = await requestHeaders(new URL("/api/healthz", baseUrl), { timeoutMs: options.idleTimeoutMs ?? 5000, signal: options.signal });
  if (health.status !== 200) throw new Error("SSE 中断后入口健康检查失败");
  return { completed, cancellation, health_after_cancel: health.status };
}
