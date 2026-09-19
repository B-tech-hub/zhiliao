import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyProxyTimeout, evaluateProxyScenario, probeProxyRequest, validateProxyTimeoutOptions, verifyDemoProxyTimeouts } from "../../scripts/verify-demo-proxy-timeouts.mjs";
import { createProxyUpstream } from "../../scripts/fixtures/demo-proxy-upstream.mjs";
import { removeOwnedTemp } from "../../scripts/demo-verification-utils.mjs";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) {
    if (fs.existsSync(dir)) removeOwnedTemp(dir, "zhiliao-demo-proxy-");
  }
});

function observation(overrides = {}) {
  return { statusCode: 504, endedNormally: true, done: false, receivedChunks: 1, heartbeatEvents: 0,
    firstBodyMs: 300000, lastBodyMs: 300000, maxBodyGapMs: 300000, uploadBytes: 0, lastUploadProgressMs: 0,
    budgetExhausted: false, errorCode: null, elapsedMs: 300010, ...overrides };
}

function fixture({ conflict = false, failStartup = false, foreignCleanup = false, failCleanup = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-demo-proxy-test-"));
  temporary.push(directory);
  const calls: string[][] = [];
  const paths: string[] = [];
  let active = false;
  let runId = "";
  let project = "";
  const docker = async (args: string[]) => {
    calls.push(args);
    const listing = args[0] === "ps" || args[1] === "ls";
    if (listing) {
      if (conflict && args[0] === "ps") return "existing";
      if (!active) return "";
      return args[0] === "ps" ? "upstream\ningress" : args[0] === "network" ? "network" : "";
    }
    if (args[1] === "inspect") {
      if (args[0] === "image") return "sha256:" + "a".repeat(64);
      return JSON.stringify({ "com.docker.compose.project": project,
        "io.zhiliao.demo-proxy-verify.run": foreignCleanup && paths.length === 4 ? "foreign" : runId });
    }
    if (args.includes("config")) {
      const work = args[args.indexOf("--project-directory") + 1];
      project = args[args.indexOf("-p") + 1];
      const envFile = args[args.indexOf("--env-file") + 1];
      expect(path.isAbsolute(work)).toBe(true);
      expect(fs.existsSync(args[args.indexOf("-f") + 1])).toBe(true);
      const env = fs.readFileSync(envFile, "utf8");
      runId = env.match(/DEMO_VERIFY_RUN_ID=(.+)/)![1];
      const labels = { "io.zhiliao.demo-proxy-verify.run": runId };
      const service = (file: string, image: string) => ({ image, labels, read_only: true, networks: { proxy_net: {} },
        volumes: [{ type: "bind", source: path.join(work, file), read_only: true }] });
      return JSON.stringify({ services: {
        "proxy-upstream": service("scripts/fixtures/demo-proxy-upstream.mjs", "zhiliao-demo-verify:story-2-2"),
        ingress: { ...service("nginx/demo-proxy.conf", "nginx:fixture"),
          ports: [{ host_ip: "127.0.0.1", published: "3333", target: 8080 }] },
      }, networks: { proxy_net: { name: project + "-proxy-net", labels } } });
    }
    if (args.includes("up")) { active = true; if (failStartup) throw new Error("startup failed"); }
    if (args.includes("down")) { if (failCleanup) throw new Error("cleanup failed"); active = false; }
    if (args.includes("port")) return "127.0.0.1:3333";
    if (args.includes("-T") && args.includes("nginx")) return fs.readFileSync("nginx/demo-proxy.conf", "utf8");
    if (args.includes("logs")) return paths.filter((item) => !item.startsWith("/heartbeat")).map((item) =>
      'upstream timed out while ' + (item.startsWith("/upload") ? "sending request to upstream"
        : item.startsWith("/stream") ? "reading upstream" : "reading response header from upstream") +
      ', request: "' + (item.startsWith("/upload") ? "POST" : "GET") + " " + item + ' HTTP/1.1"').join("\n");
    return "fixture";
  };
  const requestFn = async (url: string) => {
    const target = new URL(url);
    paths.push(target.pathname + target.search);
    if (target.pathname === "/stream") return observation({ statusCode: 200, endedNormally: false, lastBodyMs: 10, firstBodyMs: 10 });
    if (target.pathname === "/upload") return observation({ uploadBytes: 8 * 1024 * 1024, lastUploadProgressMs: 10 });
    if (target.pathname === "/heartbeat") return observation({ statusCode: 200, done: true, heartbeatEvents: 6, elapsedMs: 360050, maxBodyGapMs: 60020 });
    return observation();
  };
  return { calls, paths, docker, requestFn, evidencePath: path.join(directory, "report.json") };
}

async function withServer(server: http.Server, run: (url: string) => Promise<void>) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("缺少本机夹具端口");
    await run("http://127.0.0.1:" + address.port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Demo Nginx 代理空闲时限验收工具", () => {
  it("已发送 HTTP 200 的 SSE 中断应按对应读取日志判断", () => {
    expect(classifyProxyTimeout({
      elapsedSeconds: 300, statusCode: 200, log: 'upstream timed out while reading upstream, request: "GET /stream?probe=test HTTP/1.1"',
      expected: "read", budgetSeconds: 450, scenario: "stream", requestPath: "/stream?probe=test", receivedChunks: 1, endedNormally: false,
    }).passed).toBe(true);
  });

  it("不能借用其他请求的超时日志", () => {
    expect(classifyProxyTimeout({
      elapsedSeconds: 300, statusCode: 504,
      log: 'upstream timed out while reading response header from upstream, request: "GET /silent?probe=other HTTP/1.1"',
      expected: "read", budgetSeconds: 450, requestPath: "/silent?probe=current",
    }).passed).toBe(false);
  });

  it("只有实际时长、对应日志和响应结束方式都满足才通过", () => {
    const input = { elapsedSeconds: 300, statusCode: 504, expected: "read", budgetSeconds: 450,
      requestPath: "/silent?probe=test", log: 'upstream timed out while reading response header from upstream, request: "GET /silent?probe=test HTTP/1.1"' };
    expect(classifyProxyTimeout(input).passed).toBe(true);
    expect(classifyProxyTimeout({ ...input, elapsedSeconds: 30 }).passed).toBe(false);
    expect(classifyProxyTimeout({ ...input, budgetExhausted: true }).passed).toBe(false);
    expect(classifyProxyTimeout({ ...input, log: "" }).passed).toBe(false);
  });

  it("心跳必须持续超过 300 秒、有六次事件且正常 done", () => {
    const complete = observation({ statusCode: 200, done: true, heartbeatEvents: 6, elapsedMs: 360050, maxBodyGapMs: 60020 });
    expect(evaluateProxyScenario("heartbeat", complete, "", "/heartbeat", 450).passed).toBe(true);
    for (const patch of [{ elapsedMs: 100 }, { done: false }, { heartbeatEvents: 0 }, { endedNormally: false }, { maxBodyGapMs: 300000 }]) {
      expect(evaluateProxyScenario("heartbeat", { ...complete, ...patch }, "", "/heartbeat", 450).passed).toBe(false);
    }
  });

  it("上传场景不能把客户端正文超时或上游读取超时当作发送超时", () => {
    const result = observation({ uploadBytes: 1024, lastUploadProgressMs: 10 });
    const requestPath = "/upload?probe=test";
    for (const reason of ["client timed out while reading client request body", "upstream timed out while reading response header from upstream"]) {
      expect(evaluateProxyScenario("upload", result, reason + ', request: "POST ' + requestPath + ' HTTP/1.1"', requestPath, 450).passed).toBe(false);
    }
  });

  it("真实取证固定 300 秒并限制总预算", () => {
    expect(() => validateProxyTimeoutOptions({ budgetSeconds: 300 })).toThrow("总预算");
    expect(() => validateProxyTimeoutOptions({ readTimeoutSeconds: 1 })).toThrow("300");
    expect(() => validateProxyTimeoutOptions({ budgetSeconds: 451 })).toThrow("总预算");
  });

  it("四个请求按固定顺序分别取证，之后检查归属和清理", async () => {
    const f = fixture();
    const result = await verifyDemoProxyTimeouts({ evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(0);
    expect(result.report.scenarios.map((item) => item.name)).toEqual(["silent", "stream", "heartbeat", "upload"]);
    expect(f.paths.map((item) => item.split("?")[0])).toEqual(["/silent", "/stream", "/heartbeat", "/upload"]);
    expect(result.report.scenarios.every((item) => item.passed)).toBe(true);
    expect(result.report.cleanup.status).toBe("removed");
    expect(f.calls.find((args) => args.includes("up"))).toEqual(expect.arrayContaining(["--pull", "never", "--no-build"]));
    expect(f.calls.find((args) => args.includes("config"))).toContain("--env-file");
  });

  it("已有 project 资源时不启动或清理", async () => {
    const f = fixture({ conflict: true });
    const result = await verifyDemoProxyTimeouts({ evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    expect(f.calls.some((args) => args.includes("up") || args.includes("down"))).toBe(false);
  });

  it("部分启动失败后仍清理本次资源", async () => {
    const f = fixture({ failStartup: true });
    const result = await verifyDemoProxyTimeouts({ evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report.cleanup.status).toBe("removed");
  });

  it.each([{ foreignCleanup: true }, { failCleanup: true }])("清理失败时返回非零并保留恢复配置 %j", async (failure) => {
    const f = fixture(failure);
    const result = await verifyDemoProxyTimeouts({ evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report.cleanup.status).toBe("failed");
    if (!result.report.recovery) throw new Error("缺少清理恢复信息");
    expect(fs.existsSync(result.report.recovery.directory)).toBe(true);
    temporary.push(result.report.recovery.directory);
    if (failure.foreignCleanup) expect(f.calls.some((args) => args.includes("down"))).toBe(false);
  });

  it("GET 请求读完后专用夹具仍持续发送心跳并支持查询标识", async () => {
    const server = createProxyUpstream({ heartbeatIntervalMs: 15, heartbeatDurationMs: 120 });
    expect(server.requestTimeout).toBe(0);
    await withServer(server, async (url) => {
      const result = await probeProxyRequest(url + "/heartbeat?probe=test", { timeoutMs: 1500 });
      expect(result).toMatchObject({ statusCode: 200, endedNormally: true, done: true, budgetExhausted: false });
      expect(result.heartbeatEvents).toBeGreaterThanOrEqual(6);
    });
  });

  it("HTTP 200 后异常断流保留状态码、首块和非正常结束", async () => {
    await withServer(http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"delta":"start"}\n\n');
      setTimeout(() => res.destroy(), 30);
    }), async (url) => {
      const result = await probeProxyRequest(url, { timeoutMs: 1000 });
      expect(result).toMatchObject({ statusCode: 200, endedNormally: false, done: false, receivedChunks: 1, budgetExhausted: false });
      expect(result.firstBodyMs).not.toBeNull();
    });
  });

  it("客户端总预算耗尽会停止上传并明确标记原因", async () => {
    await withServer(createProxyUpstream(), async (url) => {
      const result = await probeProxyRequest(url + "/upload", { method: "POST", uploadBytes: 32 * 1024 * 1024, timeoutMs: 80 });
      expect(result).toMatchObject({ budgetExhausted: true, endedNormally: false, errorCode: "CLIENT_BUDGET" });
      expect(result.uploadBytes).toBeGreaterThan(0);
      expect(result.uploadBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    });
  });
});
