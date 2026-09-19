import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CANDIDATE_IMAGE, REPO_ROOT, attachVerificationSignals, cleanDockerEnvironment, removeOwnedTemp, runDocker, verificationResources } from "./demo-verification-utils.mjs";

const RUN_LABEL = "io.zhiliao.demo-proxy-verify.run";
const SNAPSHOTS = ["docker-compose.demo.proxy-verify.yml", "nginx/demo-proxy.conf", "scripts/fixtures/demo-proxy-upstream.mjs"];
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

export function validateProxyTimeoutOptions(options = {}) {
  const readTimeoutSeconds = options.readTimeoutSeconds ?? 300;
  const sendTimeoutSeconds = options.sendTimeoutSeconds ?? 300;
  const budgetSeconds = options.budgetSeconds ?? 450;
  if (readTimeoutSeconds !== 300 || sendTimeoutSeconds !== 300) throw new Error("正式取证必须保留 300 秒读写时限");
  if (!Number.isInteger(budgetSeconds) || budgetSeconds <= 360 || budgetSeconds > 450) {
    throw new Error("总预算必须大于 360 秒心跳场景且不超过 450 秒");
  }
  return { readTimeoutSeconds, sendTimeoutSeconds, budgetSeconds };
}

export function classifyProxyTimeout({
  elapsedSeconds, statusCode, log, expected, budgetSeconds, requestPath = "",
  scenario = expected === "send" ? "upload" : "silent", idleSeconds = elapsedSeconds,
  receivedChunks = 0, endedNormally = true, done = false, uploadBytes = 0, budgetExhausted = false,
}) {
  const lines = String(log ?? "").split(/\r?\n/).filter((line) =>
    requestPath && line.includes(" " + requestPath + " HTTP/"));
  const pattern = expected === "send"
    ? /upstream timed out.*(?:sending|writing) request to upstream/i
    : scenario === "stream" ? /upstream timed out.*reading upstream/i
      : /upstream timed out.*reading response header from upstream/i;
  const logMatch = lines.some((line) => pattern.test(line));
  const budget = budgetExhausted || elapsedSeconds >= budgetSeconds;
  const responseMatches = scenario === "stream"
    ? statusCode === 200 && receivedChunks > 0 && !endedNormally && !done
    : expected === "send" ? uploadBytes > 0 && [504, null, "client-aborted"].includes(statusCode)
      : statusCode === 504 && endedNormally;
  const durationMatches = idleSeconds >= 295 && idleSeconds <= 330;
  return {
    passed: durationMatches && logMatch && !budget && responseMatches,
    elapsedSeconds, idle_seconds: idleSeconds, log_match: logMatch, budget_exhausted: budget, log_lines: lines,
    reason: budget ? "客户端总预算先耗尽" : !logMatch ? "缺少此请求的 Nginx 对应超时日志"
      : !durationMatches ? "实际空闲时长不在 295 至 330 秒范围内"
        : !responseMatches ? "响应结束方式或请求发送量与场景不符" : undefined,
  };
}

// HTTP 200 后断流时仍保存首块、最后进展和结束原因。
export function probeProxyRequest(url, { method = "GET", uploadBytes = 0, timeoutMs = 450000, signal } = {}) {
  if (!Number.isInteger(uploadBytes) || uploadBytes < 0 || uploadBytes > MAX_UPLOAD_BYTES) throw new Error("上传超出 32 MiB 预算");
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ statusCode: null, endedNormally: false, done: false, receivedChunks: 0, heartbeatEvents: 0,
        firstBodyMs: null, lastBodyMs: 0, maxBodyGapMs: 0, uploadBytes: 0, lastUploadProgressMs: 0,
        budgetExhausted: false, errorCode: "ABORTED", elapsedMs: 0 });
      return;
    }
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    const result = {
      statusCode: null, endedNormally: false, done: false, receivedChunks: 0, heartbeatEvents: 0,
      firstBodyMs: null, lastBodyMs: 0, maxBodyGapMs: 0, uploadBytes: 0, lastUploadProgressMs: 0,
      budgetExhausted: false, errorCode: null, elapsedMs: 0,
    };
    let settled = false;
    let pending = "";
    let previousBodyMs = 0;
    const req = http.request(url, { method, agent: false, headers: uploadBytes ? { "Content-Length": String(uploadBytes) } : {} });
    const finish = (errorCode = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      result.elapsedMs = elapsed();
      result.errorCode = errorCode;
      req.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => { result.budgetExhausted = true; finish("CLIENT_BUDGET"); }, timeoutMs);
    const onAbort = () => finish("ABORTED");
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", (error) => finish(error.code ?? "REQUEST_ERROR"));
    req.on("response", (res) => {
      result.statusCode = res.statusCode;
      res.on("data", (chunk) => {
        const at = elapsed();
        result.firstBodyMs ??= at;
        result.receivedChunks += 1;
        result.lastBodyMs = at;
        result.maxBodyGapMs = Math.max(result.maxBodyGapMs, at - previousBodyMs);
        previousBodyMs = at;
        pending += chunk.toString();
        let boundary;
        while ((boundary = pending.indexOf("\n\n")) !== -1) {
          const event = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          if (!event.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(event.slice(6));
            if (data.done === true) result.done = true;
            if (data.heartbeat === true) result.heartbeatEvents += 1;
          } catch { /* 非 SSE 正文不作为结束或心跳证据。 */ }
        }
        if (pending.length > 4096) pending = pending.slice(-4096);
      });
      res.on("end", () => { result.endedNormally = true; finish(); });
      res.on("aborted", () => finish("RESPONSE_ABORTED"));
      res.on("error", (error) => finish(error.code ?? "RESPONSE_ERROR"));
      res.on("close", () => { if (!result.endedNormally) finish("RESPONSE_CLOSED"); });
    });
    if (!uploadBytes) { req.end(); return; }
    const chunk = Buffer.alloc(64 * 1024, 65);
    const pump = () => {
      while (!settled && result.uploadBytes < uploadBytes) {
        const data = chunk.subarray(0, Math.min(chunk.length, uploadBytes - result.uploadBytes));
        result.uploadBytes += data.length;
        const writable = req.write(data, (error) => { if (!error && !settled) result.lastUploadProgressMs = elapsed(); });
        if (!writable) { req.once("drain", pump); return; }
      }
      if (!settled) req.end();
    };
    pump();
  });
}

export function evaluateProxyScenario(name, result, log, requestPath, budgetSeconds) {
  const elapsedSeconds = result.elapsedMs / 1000;
  if (name === "heartbeat") {
    const logLines = String(log).split(/\r?\n/).filter((line) => line.includes(" " + requestPath + " HTTP/") && /timed out/i.test(line));
    const passed = result.statusCode === 200 && result.endedNormally && result.done && result.heartbeatEvents >= 6 &&
      elapsedSeconds >= 355 && elapsedSeconds < budgetSeconds && result.maxBodyGapMs < 300000 &&
      !result.budgetExhausted && logLines.length === 0;
    return { passed, elapsedSeconds, log_match: false, log_lines: logLines, budget_exhausted: result.budgetExhausted,
      reason: passed ? undefined : "未证明超过 300 秒且持续心跳、正常 done 的完整连接" };
  }
  const lastProgress = name === "stream" ? result.lastBodyMs : name === "upload" ? result.lastUploadProgressMs : 0;
  return classifyProxyTimeout({ ...result, scenario: name, elapsedSeconds, idleSeconds: (result.elapsedMs - lastProgress) / 1000,
    expected: name === "upload" ? "send" : "read", log, requestPath, budgetSeconds });
}

function validateConfig(config, project, runId, port, work) {
  if (Object.keys(config.services ?? {}).sort().join() !== "ingress,proxy-upstream" || Object.keys(config.volumes ?? {}).length) {
    throw new Error("代理验收配置超出两个无业务卷服务的范围");
  }
  const network = config.networks?.proxy_net;
  if (Object.keys(config.networks ?? {}).length !== 1 || network?.name !== project + "-proxy-net" || network.external || network.labels?.[RUN_LABEL] !== runId) {
    throw new Error("代理验收网络归属不匹配");
  }
  for (const [name, service] of Object.entries(config.services)) {
    const expectedSource = name === "ingress" ? "nginx/demo-proxy.conf" : "scripts/fixtures/demo-proxy-upstream.mjs";
    const mounts = service.volumes ?? [];
    if (service.container_name || service.labels?.[RUN_LABEL] !== runId || !service.read_only ||
      Object.keys(service.networks ?? {}).join() !== "proxy_net" || mounts.length !== 1 || mounts[0].type !== "bind" ||
      !mounts[0].read_only || path.resolve(mounts[0].source) !== path.join(work, expectedSource)) {
      throw new Error("代理验收服务配置不符合本次只读范围");
    }
  }
  if (config.services["proxy-upstream"].image !== CANDIDATE_IMAGE || config.services["proxy-upstream"].ports?.length) {
    throw new Error("专用上游必须复用本地候选且不发布端口");
  }
  const ports = config.services.ingress.ports ?? [];
  if (ports.length !== 1 || ports[0].host_ip !== "127.0.0.1" || String(ports[0].published) !== String(port) || ports[0].target !== 8080) {
    throw new Error("代理验收端口没有正确绑定本机");
  }
}

/**
 * @returns {Promise<{exitCode: number, evidencePath: string, report: {
 * status: string, scenarios: Array<{name: string, passed: boolean}>, cleanup: {status: string},
 * recovery?: {directory: string, run_label: string, cleanup_arguments: string[]}
 * }}>}
 */
export async function verifyDemoProxyTimeouts(options = {}, { docker = runDocker, requestFn = probeProxyRequest, onProgress = () => {} } = {}) {
  const limits = validateProxyTimeoutOptions(options);
  const runId = randomBytes(16).toString("hex");
  const project = options.project ?? "zhiliao-demo-proxy-verify-" + runId.slice(0, 12);
  if (!/^zhiliao-demo-proxy-verify(?:-[a-z0-9][a-z0-9-]*)?$/.test(project)) throw new Error("project 必须使用 zhiliao-demo-proxy-verify 前缀");
  const port = options.port ?? 3333;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口超出允许范围");
  const evidencePath = path.resolve(options.evidencePath ?? path.join(REPO_ROOT, "docs", "验收证据", "story-2-2-proxy-timeouts-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json"));
  if (fs.existsSync(evidencePath)) throw new Error("证据文件已存在，拒绝覆盖");
  const env = cleanDockerEnvironment();
  const abort = new AbortController();
  const detachSignals = attachVerificationSignals((signal) => abort.abort(signal));
  const invoke = (args, timeoutMs = 15000, { abortable = true } = {}) => docker(args, { env, timeoutMs, signal: abortable ? abort.signal : undefined });
  const resources = verificationResources(invoke, project, runId, RUN_LABEL);
  const cleanupResources = verificationResources((args, timeoutMs) => invoke(args, timeoutMs, { abortable: false }), project, runId, RUN_LABEL);
  const report = { story: "2.2", recorded_at: new Date().toISOString(), status: "failed", project, run_id: runId, limits,
    scenarios: [], cleanup: { status: "not_started" }, input_sha256: {},
    limitations: ["只验收本机固定 Nginx 与无业务上游的代理时限；不代替应用 SSE、目标主机、业务卷配额或镜像发布验收。"] };
  let work;
  let compose;
  let upAttempted = false;
  let progress;
  try {
    if ((await resources.list()).length) throw new Error("验收 project 已存在资源，拒绝启动");
    report.engine = await invoke(["version", "--format", "{{.Server.Version}}"]);
    report.compose = await invoke(["compose", "version", "--short"]);
    work = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-demo-proxy-verify-"));
    for (const file of [...SNAPSHOTS, "nginx/demo.conf", "scripts/verify-demo-proxy-timeouts.mjs", "scripts/demo-verification-utils.mjs"]) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file));
      report.input_sha256[file] = createHash("sha256").update(content).digest("hex");
      if (SNAPSHOTS.includes(file)) {
        fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
        fs.writeFileSync(path.join(work, file), content);
      }
    }
    for (const file of ["nginx/demo.conf", "nginx/demo-proxy.conf"]) {
      const configText = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const directive of ["proxy_read_timeout 300s;", "proxy_send_timeout 300s;", "proxy_request_buffering off;", "proxy_buffering off;"]) {
        if (!configText.includes(directive)) throw new Error("代理验收配置与 Demo 配置的时限或缓冲语义不一致");
      }
    }
    const envFile = path.join(work, "demo.env");
    fs.writeFileSync(envFile, "DEMO_VERIFY_PORT=" + port + "\nDEMO_VERIFY_RUN_ID=" + runId + "\n", { flag: "wx" });
    compose = ["compose", "--project-directory", work, "--env-file", envFile, "-p", project, "-f", path.join(work, "docker-compose.demo.proxy-verify.yml")];
    const config = JSON.parse(await invoke([...compose, "config", "--format", "json"]));
    validateConfig(config, project, runId, port, work);
    report.images = {};
    for (const [name, service] of Object.entries(config.services)) {
      const id = await invoke(["image", "inspect", "--format", "{{.Id}}", service.image]);
      if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error("无法核对本机镜像标识");
      report.images[name] = { reference: service.image, id };
    }
    upAttempted = true;
    await invoke([...compose, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "90"], 105000);
    report.resources = await resources.list();
    await resources.assertOwned(report.resources);
    if (report.resources.length !== 3) throw new Error("未找到预期的两个容器和一个网络");
    report.ingress_binding = await invoke([...compose, "port", "ingress", "8080"]);
    if (report.ingress_binding !== "127.0.0.1:" + port) throw new Error("实际代理端口与参数不一致");
    await invoke([...compose, "exec", "-T", "ingress", "nginx", "-t"]);
    report.nginx_syntax = "passed";
    const runtimeConfig = await invoke([...compose, "exec", "-T", "ingress", "nginx", "-T"]);
    report.nginx_runtime_sha256 = createHash("sha256").update(runtimeConfig).digest("hex");
    for (const directive of ["proxy_read_timeout 300s;", "proxy_send_timeout 300s;"]) {
      if (!runtimeConfig.includes(directive)) throw new Error("运行中的 Nginx 未使用 300 秒配置");
    }
    const started = Date.now();
    const completed = new Set();
    progress = setInterval(() => onProgress({ elapsed_seconds: Math.round((Date.now() - started) / 1000), completed: [...completed] }), 30000);
    const observed = [];
    for (const name of ["silent", "stream", "heartbeat", "upload"]) {
      if (abort.signal.aborted) throw new Error("验收被中断");
      const requestPath = "/" + name + "?probe=" + runId + "-" + name;
      onProgress({ scenario: name, status: "started" });
      let result;
      try {
        result = await requestFn("http://127.0.0.1:" + port + requestPath, { method: name === "upload" ? "POST" : "GET",
          uploadBytes: name === "upload" ? MAX_UPLOAD_BYTES : 0, timeoutMs: limits.budgetSeconds * 1000, signal: abort.signal });
      } catch (error) {
        result = { elapsedMs: Date.now() - started, statusCode: null, errorCode: String(error.message ?? error), budgetExhausted: false };
      }
      completed.add(name);
      onProgress({ scenario: name, status: "observed", elapsed_seconds: result.elapsedMs / 1000, status_code: result.statusCode });
      observed.push({ name, requestPath, result });
    }
    const logs = await invoke([...compose, "logs", "--no-color", "ingress"]);
    report.scenarios = observed.map(({ name, requestPath, result }) => ({
      name, request_path: requestPath, ...evaluateProxyScenario(name, result, logs, requestPath, limits.budgetSeconds), observation: result,
    }));
    report.status = report.scenarios.every((scenario) => scenario.passed) ? "passed" : "failed";
  } catch (error) {
    report.error = String(error.message ?? error);
  } finally {
    detachSignals();
    clearInterval(progress);
    if (upAttempted) {
      try {
        await cleanupResources.assertOwned(await cleanupResources.list());
        await invoke([...compose, "down", "--remove-orphans"], 30000, { abortable: false });
        if ((await cleanupResources.list()).length) throw new Error("清理后仍有本次 project 资源");
        report.cleanup.status = "removed";
      } catch (error) { report.cleanup = { status: "failed", error: String(error.message ?? error) }; report.status = "failed"; }
    }
    if (work) {
      if (report.cleanup.status === "failed") report.recovery = { directory: work, run_label: RUN_LABEL + "=" + runId, cleanup_arguments: [...compose, "down", "--remove-orphans"] };
      else {
        try { removeOwnedTemp(work, "zhiliao-demo-proxy-verify-"); }
        catch (error) { report.status = "failed"; report.cleanup = { status: "failed", error: error.message }; }
      }
    }
    report.finished_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  }
  return { exitCode: report.status === "passed" ? 0 : 1, report, evidencePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { project: { type: "string" }, port: { type: "string" }, evidence: { type: "string" }, help: { type: "boolean" } } });
    if (values.help) console.log("用法：node scripts/verify-demo-proxy-timeouts.mjs [--project zhiliao-demo-proxy-verify-名称] [--port 3333] [--evidence 路径]");
    else {
      const result = await verifyDemoProxyTimeouts({ project: values.project, port: values.port === undefined ? undefined : Number(values.port), evidencePath: values.evidence },
        { onProgress: (event) => console.log(JSON.stringify(event)) });
      console.log(JSON.stringify({ status: result.report.status, evidence: result.evidencePath, cleanup: result.report.cleanup }, null, 2));
      process.exitCode = result.exitCode;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
