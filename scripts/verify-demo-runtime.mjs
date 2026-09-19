import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { verifyDemoHttp, verifyDemoSse } from "./demo-http-probes.mjs";
import { attachVerificationSignals, runProcess } from "./demo-verification-utils.mjs";
import { verifyDemoNetwork } from "./verify-demo-network.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const IMAGE = "zhiliao-demo-verify:story-2-2";
const RUN_LABEL = "io.zhiliao.demo-verify.run";
const PROJECT_LABEL = "com.docker.compose.project";
const SNAPSHOT_FILES = ["docker-compose.demo.yml", "docker-compose.demo.verify.yml", "nginx/demo.conf"];
const NETWORK_INPUT_FILES = ["scripts/verify-demo-network.mjs", "scripts/demo-verification-utils.mjs"];
const PINNED_NGINX_IMAGE = "nginx:1.30.4-alpine@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c";
const EXPECTED_NETWORKS = {
  app: ["demo_net"],
  mockllm: ["demo_net"],
  ingress: ["demo_net", "ingress_net"],
};
const EXPECTED_LIMITS = {
  ingress: { cpus: 0.25, mem_limit: "134217728", pids_limit: 64, max_size: "5m", max_file: "2" },
  app: { cpus: 1, mem_limit: "805306368", pids_limit: 128, max_size: "10m", max_file: "3" },
  mockllm: { cpus: 0.5, mem_limit: "268435456", pids_limit: 64, max_size: "5m", max_file: "2" },
};

function runDocker(args, { env, timeoutMs = 15000, signal } = {}) {
  return runProcess("docker", args, { env, timeoutMs, signal });
}

function assertHttpChecks(http) {
  if (http?.health !== 200 || http.oversize !== 413 || http.default_oversize !== 413
      || http.upload_oversize !== 413 || http.import_midsize === 413 || http.upload_midsize === 413) {
    throw new Error("HTTP 检查没有达到预期状态");
  }
}

function integerInRange(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(name + " 超出允许范围");
  return value;
}

function removeOwnedTemp(work) {
  const resolved = fs.realpathSync(work);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith("zhiliao-demo-verify-")) {
    throw new Error("临时目录超出本次验收范围，停止清理");
  }
  fs.rmSync(resolved, { recursive: true });
}

function validateConfig(config, project, port, runId, work) {
  const services = config.services ?? {};
  if (Object.keys(services).sort().join() !== "app,ingress,mockllm") throw new Error("验收配置包含意外服务");
  for (const service of Object.values(services)) {
    if (service.labels?.[RUN_LABEL] !== runId || service.container_name) throw new Error("服务缺少本次运行标识");
  }
  for (const [kind, expected] of [
    ["volumes", { demo_db: project + "_demo_db", demo_uploads: project + "_demo_uploads", demo_notes: project + "_demo_notes" }],
    ["networks", { demo_net: project + "-net", ingress_net: project + "-ingress" }],
  ]) {
    if (Object.keys(config[kind] ?? {}).sort().join() !== Object.keys(expected).sort().join()) throw new Error("验收资源范围异常");
    for (const [key, name] of Object.entries(expected)) {
      const item = config[kind][key];
      if (item.external || item.name !== name || item.labels?.[RUN_LABEL] !== runId) throw new Error("资源不是本次独立 project 所有");
    }
  }
  if (services.app.image !== IMAGE || services.mockllm.image !== IMAGE) throw new Error("验收必须复用本地候选镜像");
  if (services.ingress.image !== PINNED_NGINX_IMAGE) throw new Error("入口必须使用固定 Nginx 摘要");
  for (const [name, expected] of Object.entries(EXPECTED_NETWORKS)) {
    const actual = Object.keys(services[name]?.networks ?? {}).sort();
    if (actual.join() !== expected.slice().sort().join()) throw new Error(name + " 网络范围异常");
  }
  const appEnvironment = services.app.environment ?? {};
  if (appEnvironment.DEMO_MODE !== "1" || appEnvironment.LLM_BASE_URL !== "http://mockllm:8787/v1" ||
      appEnvironment.LLM_API_KEY !== "demo" || appEnvironment.LLM_MODEL !== "mock" ||
      typeof appEnvironment.SESSION_SECRET !== "string" || appEnvironment.SESSION_SECRET.length < 16) {
    throw new Error("应用 Demo 环境或独立会话密钥不符合约束");
  }
  for (const [name, expected] of Object.entries(EXPECTED_LIMITS)) {
    const service = services[name] ?? {};
    const actualLogging = service.logging?.options ?? {};
    if (service.cpus !== expected.cpus || String(service.mem_limit) !== expected.mem_limit ||
        service.pids_limit !== expected.pids_limit || service.read_only !== true ||
        !service.cap_drop?.includes("ALL") || !service.security_opt?.includes("no-new-privileges:true") ||
        actualLogging["max-size"] !== expected.max_size || actualLogging["max-file"] !== expected.max_file) {
      throw new Error(name + " 资源或安全限制缺失");
    }
  }
  const ports = services.ingress.ports ?? [];
  if (ports.length !== 1 || ports[0].host_ip !== "127.0.0.1" || String(ports[0].published) !== String(port) || ports[0].target !== 8080) {
    throw new Error("验收端口没有正确绑定本机");
  }
  if (services.app.ports?.length || services.mockllm.ports?.length) throw new Error("业务容器不应发布宿主机端口");
  const appVolumes = services.app.volumes ?? [];
  const expectedMounts = { demo_db: "/data/db", demo_uploads: "/data/uploads", demo_notes: "/data/notes" };
  if (appVolumes.length !== 3 || appVolumes.some((item) => item.type !== "volume" || expectedMounts[item.source] !== item.target)) {
    throw new Error("应用挂载超出 Demo 业务卷范围");
  }
  const ingressVolumes = services.ingress.volumes ?? [];
  if (services.mockllm.volumes?.length || ingressVolumes.length !== 1 ||
      path.resolve(ingressVolumes[0].source) !== path.join(work, "nginx", "demo.conf") || !ingressVolumes[0].read_only) {
    throw new Error("入口挂载必须是本次只读配置副本");
  }
}

function validateNetworkResult(result, runtime, evidencePath) {
  const report = result?.report;
  const checks = report?.checks;
  if (result?.exitCode !== 0 || report?.status !== "passed" || report?.cleanup?.status !== "removed" ||
      report.project !== runtime.project || report.engine !== runtime.engine || report.candidate_image_id !== runtime.candidate_image_id ||
      !Array.isArray(checks) || checks.length !== 20 ||
      !checks.every((check) => check?.passed === true && typeof check.source === "string" && typeof check.target === "string") ||
      new Set(checks.map((check) => check.source + ":" + check.target)).size !== 20) {
    throw new Error("网络验收未通过或报告不完整，请查看独立网络证据");
  }
  const expectedMatrix = new Set([
    ["app", "mockllm", "reachable"], ["app", "ingress", "reachable"],
    ["mockllm", "app", "reachable"], ["mockllm", "ingress", "reachable"],
    ...["host-control", "private-10", "private-172", "private-192"].map((target) => ["control-client", target, "reachable"]),
    ...["host-control", "private-10", "private-172", "private-192", "metadata-169.254.169.254", "metadata-169.254.170.2"]
      .flatMap((target) => ["app", "mockllm"].map((source) => [source, target, "blocked"])),
  ].map(([source, target, expected]) => source + "|" + target + "|" + expected));
  const actualMatrix = new Set(checks.map((check) => [check.source, check.target, check.expected].join("|")));
  if (actualMatrix.size !== expectedMatrix.size || [...expectedMatrix].some((item) => !actualMatrix.has(item))) {
    throw new Error("网络验收未覆盖固定目标矩阵");
  }
  const sources = report.sources ?? {};
  if (Object.keys(sources).sort().join() !== "app,mockllm" ||
      Object.values(sources).some((source) => source.run_id !== runtime.run_id || source.image !== runtime.candidate_image_id) ||
      [...NETWORK_INPUT_FILES, ...SNAPSHOT_FILES.slice(0, 2)].some((file) => report.input_sha256?.[file] !== runtime.input_sha256[file])) {
    throw new Error("网络证据的来源或输入与本次 Demo 不一致");
  }
  if (typeof result.evidencePath !== "string" || path.resolve(result.evidencePath) !== evidencePath ||
      !fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile() || fs.statSync(evidencePath).size > 2 * 1024 * 1024) {
    throw new Error("缺少本次已落盘的网络证据，或证据超出读取预算");
  }
  const content = fs.readFileSync(evidencePath);
  if (JSON.stringify(JSON.parse(content.toString("utf8"))) !== JSON.stringify(report)) {
    throw new Error("网络返回结果与已落盘证据不一致");
  }
  return createHash("sha256").update(content).digest("hex");
}

// Docker 命令可以替换为夹具；局部回归因此不需要创建真实容器。
export async function verifyDemoDeployment(options = {}, {
  docker = runDocker, checkHttp = verifyDemoHttp, checkSse = verifyDemoSse, checkNetwork = verifyDemoNetwork, onProgress = () => {},
} = {}) {
  const runId = randomBytes(16).toString("hex");
  const project = options.project ?? "zhiliao-demo-verify-" + runId.slice(0, 12);
  if (!/^zhiliao-demo-verify(?:-[a-z0-9][a-z0-9-]*)?$/.test(project)) throw new Error("project 必须使用 zhiliao-demo-verify 前缀");
  const port = integerInRange(options.port ?? 3322, 1, 65535, "端口");
  const startupTimeout = integerInRange(options.startupTimeout ?? 120, 1, 300, "启动时限");
  const requestTimeout = integerInRange(options.requestTimeout ?? 10, 1, 60, "请求时限");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const evidencePath = path.resolve(options.evidencePath ?? path.join(REPO_ROOT, "docs", "验收证据", "story-2-2-runtime-" + stamp + "-" + runId.slice(0, 8) + ".json"));
  if (fs.existsSync(evidencePath)) throw new Error("证据文件已存在，拒绝覆盖");
  const networkEvidencePath = options.includeNetwork
    ? path.join(path.dirname(evidencePath), path.basename(evidencePath, path.extname(evidencePath)) + "-network.json") : null;
  if (networkEvidencePath && fs.existsSync(networkEvidencePath)) throw new Error("网络证据文件已存在，拒绝覆盖");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(DEMO_|COMPOSE_)/i.test(key)) delete env[key];
  const abort = new AbortController();
  const detachSignals = attachVerificationSignals((signal) => abort.abort(signal));
  const invoke = (args, timeoutMs = 15000, { abortable = true } = {}) => docker(args, { env, timeoutMs, signal: abortable ? abort.signal : undefined });
  const throwIfAborted = () => {
    if (abort.signal.aborted) throw new Error("验收被中断");
  };
  const password = randomBytes(24).toString("hex");
  const secret = randomBytes(32).toString("hex");
  let work;
  let composeArgs;
  let upAttempted = false;
  let stage = "preflight";
  const report = {
    story: "2.2", recorded_at: new Date().toISOString(), status: "failed", project, run_id: runId, port,
    scope: (options.includeSse ? "本机候选入口、HTTP 和 SSE" : "本机候选入口与 HTTP") + (options.includeNetwork ? "及本机网络对照" : ""),
    checks: { services_healthy: false, http: null, nginx_syntax: "not_run", sse: "not_run", network: "not_run" },
    cleanup: { status: "not_started" },
    limitations: [
      "本次只验收本机候选镜像，不代表固定的 0.6.0 发布镜像已包含补丁。",
      "业务卷硬配额、实际正式服务隔离、公网 HTTPS 和补丁镜像发布仍未完成；本机所选检查通过不代表 Story 全部完成。",
      "本工具不复验 Nginx 300 秒代理空闲超时，应另查专用代理验收证据。",
      "配置及脚本哈希用于关联本次验收输入，不证明候选镜像包含当前全部工作区源码。",
    ],
  };
  if (!options.includeSse) report.limitations.push("未选择 SSE 检查；不能关闭 SSE 验收项。");
  if (!options.includeNetwork) report.limitations.push("未选择网络检查；不能关闭本机网络验收项。");

  async function resources(abortable = true) {
    const found = new Map();
    for (const type of ["container", "network", "volume"]) {
      const list = type === "container" ? ["ps", "-a"] : [type, "ls"];
      const format = type === "volume" ? "{{.Name}}" : "{{.ID}}";
      // 同时检查标签和名称，避免误复用没有 Compose 标签的同名资源。
      for (const filter of ["label=" + PROJECT_LABEL + "=" + project, "name=" + project]) {
        const output = await invoke([...list, "--filter", filter, "--format", format], 15000, { abortable });
        for (const id of output.split(/\r?\n/).filter(Boolean)) found.set(type + ":" + id, { type, id });
      }
    }
    return [...found.values()];
  }

  async function assertOwned(items, abortable = true) {
    for (const item of items) {
      const format = item.type === "container" ? "{{json .Config.Labels}}" : "{{json .Labels}}";
      const labels = JSON.parse(await invoke([item.type, "inspect", "--format", format, item.id], 15000, { abortable }));
      if (labels?.[RUN_LABEL] !== runId || labels?.[PROJECT_LABEL] !== project) {
        throw new Error("发现不属于本次运行的资源，停止操作和自动清理");
      }
    }
  }

  try {
    report.engine = await invoke(["version", "--format", "{{.Server.Version}}"]);
    report.compose = await invoke(["compose", "version", "--short"]);
    if ((await resources()).length) throw new Error("project 名称已被占用，请使用新的独立名称");
    report.candidate_image_id = await invoke(["image", "inspect", "--format", "{{.Id}}", IMAGE]);
    if (!/^sha256:[a-f0-9]{64}$/.test(report.candidate_image_id)) throw new Error("无法核对候选镜像标识");
    const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true, timeout: 5000 });
    report.baseline_commit = revision.status === 0 ? revision.stdout.trim() : "NO_VCS";
    work = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-demo-verify-"));
    fs.mkdirSync(path.join(work, "nginx"));
    report.input_sha256 = {};
    for (const file of [...SNAPSHOT_FILES, "scripts/verify-demo-runtime.ps1", "scripts/verify-demo-runtime.mjs", "scripts/demo-http-probes.mjs",
      ...(options.includeNetwork ? NETWORK_INPUT_FILES : [])]) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file));
      report.input_sha256[file] = createHash("sha256").update(content).digest("hex");
      if (SNAPSHOT_FILES.includes(file)) fs.writeFileSync(path.join(work, file), content);
    }
    const envFile = path.join(work, "demo.env");
    fs.writeFileSync(envFile, [
      "DEMO_PASSWORD=" + password, "DEMO_SESSION_SECRET=" + secret,
      "DEMO_VERIFY_PORT=" + port, "DEMO_VERIFY_RUN_ID=" + runId, "",
    ].join("\n"), { flag: "wx", mode: 0o600 });
    composeArgs = ["compose", "--project-directory", work, "--env-file", envFile, "-p", project,
      "-f", path.join(work, "docker-compose.demo.yml"), "-f", path.join(work, "docker-compose.demo.verify.yml")];
    const config = JSON.parse(await invoke([...composeArgs, "config", "--format", "json"]));
    validateConfig(config, project, port, runId, work);
    report.images = Object.fromEntries(Object.entries(config.services).map(([name, service]) => [name, service.image]));
    throwIfAborted();
    stage = "startup";
    upAttempted = true;
    await invoke([...composeArgs, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", String(startupTimeout)], (startupTimeout + 15) * 1000);
    report.checks.services_healthy = true;
    const currentResources = await resources();
    await assertOwned(currentResources);
    if (currentResources.length !== 8) throw new Error("未找到预期的三个容器、两个网络和三个卷");
    report.resources = currentResources;
    const binding = await invoke([...composeArgs, "port", "ingress", "8080"]);
    if (binding !== "127.0.0.1:" + port) throw new Error("实际入口端口与验收参数不一致");
    report.ingress_binding = binding;
    throwIfAborted();
    stage = "http";
    report.checks.http = await checkHttp("http://127.0.0.1:" + port, { timeoutMs: requestTimeout * 1000, signal: abort.signal });
    assertHttpChecks(report.checks.http);
    stage = "nginx";
    await invoke([...composeArgs, "exec", "-T", "ingress", "nginx", "-t"]);
    report.checks.nginx_syntax = "passed";
    if (options.includeSse) {
      throwIfAborted();
      stage = "sse";
      report.checks.sse = await checkSse("http://127.0.0.1:" + port, password, { signal: abort.signal });
    }
    if (networkEvidencePath) {
      throwIfAborted();
      stage = "network";
      report.checks.network = { status: "failed", evidence: networkEvidencePath };
      // 网络对照共用 Node 事件循环，必须等待异步检查及其清理结束后再回收 Demo。
      const network = await checkNetwork({ project, evidencePath: networkEvidencePath, signal: abort.signal }, {
        onProgress: (event) => onProgress({ stage: "network", ...event }),
      });
      Object.assign(report.checks.network, {
        observed_status: network?.report?.status ?? "missing", check_count: network?.report?.checks?.length ?? 0,
        cleanup: network?.report?.cleanup, control_project: network?.report?.control_project, control_run_id: network?.report?.run_id,
      });
      report.checks.network.evidence_sha256 = validateNetworkResult(network, report, networkEvidencePath);
      report.checks.network.status = "passed";
    }
    report.status = "passed";
  } catch (error) {
    report.failed_stage = stage;
    report.error = String(error.message ?? error).replaceAll(password, "[已脱敏]").replaceAll(secret, "[已脱敏]");
  } finally {
    detachSignals();
    if (upAttempted) {
      try {
        const remaining = await resources(false);
        await assertOwned(remaining, false);
        if (options.keepResources && remaining.length) {
          report.cleanup.status = "retained";
        } else {
          if (remaining.length) await invoke([...composeArgs, "down", "-v", "--remove-orphans"], 30000, { abortable: false });
          if ((await resources(false)).length) throw new Error("清理后仍有本次 project 资源");
          report.cleanup.status = "removed";
        }
      } catch (error) {
        report.status = "failed";
        report.cleanup.status = "failed";
        report.cleanup.error = String(error.message ?? error).replaceAll(password, "[已脱敏]").replaceAll(secret, "[已脱敏]");
      }
    }
    if (work) {
      if (["retained", "failed"].includes(report.cleanup.status)) {
        report.recovery = {
          directory: work, run_label: RUN_LABEL + "=" + runId,
          cleanup_arguments: [...composeArgs, "down", "-v", "--remove-orphans"],
          note: "先核对所有资源的运行标识，再清理；临时目录包含凭据，不应提交或公开。",
        };
      } else {
        try { removeOwnedTemp(work); }
        catch (error) { report.status = "failed"; report.cleanup.status = "failed"; report.cleanup.error = error.message; }
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
    if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("需要 Node.js 22 或更高版本");
    const { values } = parseArgs({ options: {
      project: { type: "string" }, port: { type: "string" }, "startup-timeout": { type: "string" },
      "request-timeout": { type: "string" }, evidence: { type: "string" },
      "keep-resources": { type: "boolean" }, "include-sse": { type: "boolean" }, "include-network": { type: "boolean" }, help: { type: "boolean" },
    } });
    if (values.help) {
      console.log("用法：node scripts/verify-demo-runtime.mjs [--port 3322] [--project zhiliao-demo-verify-名称] [--include-sse] [--include-network] [--keep-resources] [--evidence 路径]");
    } else {
      const result = await verifyDemoDeployment({
        project: values.project, port: values.port === undefined ? undefined : Number(values.port),
        startupTimeout: values["startup-timeout"] === undefined ? undefined : Number(values["startup-timeout"]),
        requestTimeout: values["request-timeout"] === undefined ? undefined : Number(values["request-timeout"]),
        evidencePath: values.evidence, keepResources: values["keep-resources"], includeSse: values["include-sse"], includeNetwork: values["include-network"],
      }, { onProgress: (event) => console.log(JSON.stringify(event)) });
      console.log(JSON.stringify({ status: result.report.status, evidence: result.evidencePath, cleanup: result.report.cleanup, recovery: result.report.recovery }, null, 2));
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
