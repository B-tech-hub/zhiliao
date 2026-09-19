import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CANDIDATE_IMAGE, PROJECT_LABEL, REPO_ROOT, cleanDockerEnvironment, runDocker, runProcess, verificationResources } from "./demo-verification-utils.mjs";

const RUN_LABEL = "io.zhiliao.demo-network-verify.run";
const DEMO_RUN_LABEL = "io.zhiliao.demo-verify.run";
const METADATA_TARGETS = ["169.254.169.254", "169.254.170.2"].map((host) => ({ name: "metadata-" + host, host, port: 80, kind: "metadata" }));

export function evaluateNetworkProbe(result) {
  const code = String(result.code ?? "").toUpperCase();
  const reached = result.connected === true || code === "ECONNREFUSED";
  const blocked = !reached && (code === "ENETUNREACH" || (code === "EHOSTUNREACH" && result.route_available === false));
  return {
    classification: reached ? (code === "ECONNREFUSED" ? "reached-refused" : "reached") : blocked ? "blocked-unreachable" : "inconclusive",
    passed: blocked, code, route_available: result.route_available,
    reason: reached ? "已到达目标，不能作为隔离通过" : blocked ? undefined : "缺少可归因的路由或策略阻断证据，单纯超时不算通过",
  };
}

function ipv4(value) {
  if (net.isIP(value) !== 4) throw new Error("无效的 IPv4 地址");
  return value.split(".").reduce((sum, part) => sum * 256 + Number(part), 0) >>> 0;
}

function range(cidr) {
  const [address, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error("无效的 IPv4 子网");
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const start = (ipv4(address) & mask) >>> 0;
  return [start, start + 2 ** (32 - prefix) - 1];
}

export function chooseControlSubnets(occupied) {
  const ranges = occupied.filter((cidr) => cidr !== "0.0.0.0/0" && !cidr.includes(":")).map(range);
  const groups = [
    Array.from({ length: 24 }, (_, i) => "10." + (230 + i) + ".250.0/29"),
    Array.from({ length: 16 }, (_, i) => "172." + (16 + i) + ".250.0/29"),
    Array.from({ length: 24 }, (_, i) => "192.168." + (230 + i) + ".0/29"),
  ];
  return groups.map((candidates) => {
    const subnet = candidates.find((cidr) => {
      const [start, end] = range(cidr);
      return ranges.every(([otherStart, otherEnd]) => end < otherStart || start > otherEnd);
    });
    if (!subnet) throw new Error("没有不与既有网络或路由冲突的私网对照子网");
    ranges.push(range(subnet));
    return subnet;
  });
}

// 函数文本发送给容器内 Node；输入仅由 JSON 序列化，绝不经过容器 shell。
function containerProbe({ host, port, token, readControl }, net, fs) {
  const started = Date.now();
  const socket = net.createConnection({ host, port, timeout: 3000 });
  let finished = false;
  let data = "";
  let address = null;
  function routeAvailable() {
    if (net.isIP(host) !== 4) return null;
    try {
      const target = host.split(".").reduce((value, part) => value * 256 + Number(part), 0) >>> 0;
      const little = (hex) => parseInt(hex.match(/../g).reverse().join(""), 16) >>> 0;
      return fs.readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1).some((line) => {
        const fields = line.trim().split(/\s+/);
        return (parseInt(fields[3], 16) & 1) && ((target & little(fields[7])) >>> 0) === little(fields[1]);
      });
    } catch { return null; }
  }
  function finish(result) {
    if (finished) return;
    finished = true;
    console.log(JSON.stringify({ token, elapsed_ms: Date.now() - started, remote_address: address, route_available: routeAvailable(), ...result }));
    socket.destroy();
  }
  socket.on("connect", () => { address = socket.remoteAddress; if (!readControl) finish({ connected: true }); });
  socket.on("data", (chunk) => {
    data += chunk.toString();
    if (data.length > 4096) finish({ code: "CONTROL_OVERFLOW" });
    else if (data.includes("\n")) finish({ connected: true, value: data.trim() });
  });
  socket.on("end", () => finish({ connected: true, value: data.trim() }));
  socket.on("timeout", () => finish({ code: "ETIMEDOUT" }));
  socket.on("error", (error) => finish({ code: error.code ?? "UNKNOWN" }));
}

export function buildProbeScript(host, port, token, readControl = false) {
  return "const probeInput=" + JSON.stringify({ host, port, token, readControl }) + ";\n" +
    "Promise.all([import('node:net'),import('node:fs')]).then(([net,fs])=>(" + containerProbe.toString() + ")(probeInput,net,fs));";
}

function parseProbeOutput(output, token) {
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    try {
      const result = JSON.parse(line);
      if (result.token === token) { delete result.token; return result; }
    } catch { /* Docker 提示行不是探针结果。 */ }
  }
  throw new Error("探针没有返回本次校验值");
}

export async function listenControlServer(token) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.end(token + "\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const port = server.address().port;
  return { port, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}

async function hostRoutes() {
  const interfaces = Object.values(os.networkInterfaces()).flat().filter((item) => item?.family === "IPv4").map((item) => item.cidr);
  if (process.platform === "win32") {
    const output = await runProcess("powershell.exe", ["-NoProfile", "-Command",
      "Get-NetRoute -AddressFamily IPv4 | Select-Object -ExpandProperty DestinationPrefix | ConvertTo-Json -Compress"]);
    return [...interfaces, ...[].concat(JSON.parse(output))];
  }
  if (process.platform === "linux") {
    const routes = fs.readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1).map((line) => {
      const fields = line.trim().split(/\s+/);
      const address = fields[1].match(/../g).reverse().map((part) => parseInt(part, 16)).join(".");
      const prefix = parseInt(fields[7], 16).toString(2).replaceAll("0", "").length;
      return address + "/" + prefix;
    });
    return [...interfaces, ...routes];
  }
  throw new Error("此平台尚未实现宿主机路由检查，停止创建对照网络");
}

async function loadDemoSources(invoke, project, network, candidateImageId) {
  if (!network.Internal || network.Options?.["com.docker.network.bridge.gateway_mode_ipv4"] !== "isolated" ||
    network.Labels?.[PROJECT_LABEL] !== project || !network.Labels?.[DEMO_RUN_LABEL]) {
    throw new Error("只能检查带运行标识的 isolated Demo 验收网络");
  }
  const sources = {};
  const format = '{"id":{{json .Id}},"image":{{json .Image}},"state":{{json .State}},"labels":{{json .Config.Labels}},"networks":{{json .NetworkSettings.Networks}}}';
  for (const service of ["app", "mockllm"]) {
    const ids = (await invoke(["ps", "-a", "-q", "--filter", "label=" + PROJECT_LABEL + "=" + project,
      "--filter", "label=com.docker.compose.service=" + service])).split(/\r?\n/).filter(Boolean);
    if (ids.length !== 1) throw new Error("必须找到唯一的 Demo 服务容器：" + service);
    const item = JSON.parse(await invoke(["container", "inspect", "--format", format, ids[0]]));
    if (!item.state.Running || item.state.Health?.Status !== "healthy" || item.image !== candidateImageId ||
      item.labels?.[PROJECT_LABEL] !== project || item.labels?.[DEMO_RUN_LABEL] !== network.Labels[DEMO_RUN_LABEL] ||
      Object.keys(item.networks).join() !== network.Name || item.networks[network.Name].NetworkID !== network.Id) {
      throw new Error("Demo 来源不满足镜像、归属、健康或网络要求：" + service);
    }
    sources[service] = { id: item.id, image: item.image, network_id: network.Id, run_id: item.labels[DEMO_RUN_LABEL] };
  }
  return sources;
}

function allowedProbeScript(url, mock) {
  const options = mock ? { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "__zhiliao_mock_probe__" }] }) } : {};
  return "fetch(" + JSON.stringify(url) + ", { ..." + JSON.stringify(options) +
    ", signal: AbortSignal.timeout(5000) }).then(async r=>{await r.arrayBuffer();console.log(JSON.stringify({status:r.status}))}).catch(e=>console.log(JSON.stringify({error:e.code||e.name})))";
}

/**
 * @returns {Promise<{exitCode: number, evidencePath: string, report: {
 * status: string, checks: Array<{source: string, target: string, expected: string, passed: boolean}>,
 * cleanup: {status: string}
 * }}>}
 */
export async function verifyDemoNetwork(options = {}, { docker = runDocker, controlServer = listenControlServer, readHostRoutes = hostRoutes, onProgress = () => {} } = {}) {
  const project = options.project;
  if (!/^zhiliao-demo-verify(?:-[a-z0-9][a-z0-9-]*)?$/.test(project ?? "")) {
    throw new Error("请用 --project 指定已启动且带运行标识的 zhiliao-demo-verify 实例");
  }
  if (options.services && [...options.services].sort().join() !== "app,mockllm") throw new Error("必须同时检查 app 和 mockllm");
  const runId = randomBytes(16).toString("hex");
  const controlProject = "zhiliao-demo-network-verify-" + runId.slice(0, 12);
  const env = cleanDockerEnvironment();
  const invoke = (args, timeoutMs = 15000, input) => docker(args, { env, timeoutMs, input, signal: options.signal });
  const resources = verificationResources(invoke, controlProject, runId, RUN_LABEL);
  const evidencePath = path.resolve(options.evidencePath ?? path.join(REPO_ROOT, "docs", "验收证据", "story-2-2-network-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json"));
  if (fs.existsSync(evidencePath)) throw new Error("证据文件已存在，拒绝覆盖");
  const report = { story: "2.2", recorded_at: new Date().toISOString(), status: "failed", project, control_project: controlProject, run_id: runId,
    services: ["app", "mockllm"], targets: [...METADATA_TARGETS], checks: [], input_sha256: {}, cleanup: { status: "not_started" },
    limitations: ["仅证明本次 Docker Engine 和已测路径，不代替最终部署主机或正式服务验收。",
      "宿主机正向对照不可用时保留未完成，不自动改为监听所有网卡。", "TCP 探针不读取元数据内容；单纯超时与连接拒绝均不作为隔离通过。"] };
  let control;
  let controlAttempted = false;
  let counter = 0;
  const labels = ["--label", PROJECT_LABEL + "=" + controlProject, "--label", RUN_LABEL + "=" + runId];
  const bounds = ["--pull", "never", "--read-only", "--memory", "64m", "--cpus", "0.25", "--pids-limit", "32",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--log-driver", "json-file", "--log-opt", "max-size=1m", "--log-opt", "max-file=1"];
  let isDesktop;

  async function probeControl(network, host, port, token) {
    controlAttempted = true;
    const hosts = host === "host.docker.internal" && !isDesktop ? ["--add-host", "host.docker.internal:host-gateway"] : [];
    const output = await invoke(["run", "--rm", "-i", "--name", controlProject + "-client-" + (++counter), ...bounds, ...labels,
      "--network", network, ...hosts, CANDIDATE_IMAGE, "node"], 15000, buildProbeScript(host, port, token, true));
    return parseProbeOutput(output, token);
  }

  async function checkBlocked(sources, target, controlPassed = true) {
    for (const [source, container] of Object.entries(sources)) {
      const token = randomBytes(12).toString("hex");
      try {
        const output = await invoke(["exec", "-i", container.id, "node"], 10000, buildProbeScript(target.host, target.port, token));
        const raw = parseProbeOutput(output, token);
        const checked = evaluateNetworkProbe(raw);
        report.checks.push({ source, target: target.name, expected: "blocked", ...checked, elapsed_ms: raw.elapsed_ms,
          positive_control: target.kind === "metadata" ? "允许路径及来源路由" : controlPassed,
          passed: checked.passed && controlPassed, reason: controlPassed ? checked.reason : "目标正向对照不可用，不能关闭此路径" });
      } catch (error) {
        report.checks.push({ source, target: target.name, expected: "blocked", passed: false, reason: String(error.message ?? error) });
      }
    }
    onProgress({ target: target.name, status: "observed" });
  }

  try {
    if ((await resources.list()).length) throw new Error("对照资源名称已被占用");
    report.engine = await invoke(["version", "--format", "{{.Server.Version}}"]);
    report.engine_os = await invoke(["info", "--format", "{{.OperatingSystem}}"]);
    isDesktop = /docker desktop/i.test(report.engine_os);
    report.candidate_image_id = await invoke(["image", "inspect", "--format", "{{.Id}}", CANDIDATE_IMAGE]);
    if (!/^sha256:[a-f0-9]{64}$/.test(report.candidate_image_id)) throw new Error("无法核对本地候选镜像");
    for (const file of ["scripts/verify-demo-network.mjs", "scripts/demo-verification-utils.mjs", "docker-compose.demo.yml", "docker-compose.demo.verify.yml"]) {
      report.input_sha256[file] = createHash("sha256").update(fs.readFileSync(path.join(REPO_ROOT, file))).digest("hex");
    }
    const networkIds = (await invoke(["network", "ls", "--format", "{{.ID}}"])).split(/\r?\n/).filter(Boolean);
    const networks = JSON.parse(await invoke(["network", "inspect", ...networkIds]));
    report.networks_before = networks.map((item) => ({ id: item.Id, name: item.Name, internal: item.Internal,
      subnets: (item.IPAM?.Config ?? []).map((entry) => entry.Subnet).filter(Boolean), endpoint_ids: Object.keys(item.Containers ?? {}) }));
    const demoNetwork = networks.find((item) => item.Name === project + "-net");
    if (!demoNetwork) throw new Error("找不到指定 Demo 网络");
    const sources = await loadDemoSources(invoke, project, demoNetwork, report.candidate_image_id);
    report.sources = sources;
    report.routes = {};
    for (const [source, container] of Object.entries(sources)) {
      report.routes[source] = await invoke(["exec", "-i", container.id, "node"], 10000,
        "console.log(require('node:fs').readFileSync('/proc/net/route','utf8'))");
      for (const [target, url, mock] of source === "app"
        ? [["mockllm", "http://mockllm:8787/v1/chat/completions", true], ["ingress", "http://ingress:8080/api/healthz", false]]
        : [["app", "http://app:3000/api/healthz", false], ["ingress", "http://ingress:8080/api/healthz", false]]) {
        const result = JSON.parse(await invoke(["exec", "-i", container.id, "node"], 10000, allowedProbeScript(url, mock)));
        report.checks.push({ source, target, expected: "reachable", status_code: result.status, passed: result.status === 200 });
      }
    }
    if (report.checks.some((item) => !item.passed)) throw new Error("允许路径不通，不能使用此来源证明隔离");
    const occupied = [...networks.flatMap((item) => (item.IPAM?.Config ?? []).map((entry) => entry.Subnet).filter(Boolean)), ...await readHostRoutes()];
    const subnets = chooseControlSubnets(occupied);
    report.control_subnets = subnets;
    report.occupied_routes_sha256 = createHash("sha256").update(JSON.stringify(occupied.sort())).digest("hex");

    const hostToken = randomBytes(12).toString("hex");
    control = await controlServer(hostToken);
    report.host_control = { bind: "127.0.0.1", port: control.port, token_sha256: createHash("sha256").update(hostToken).digest("hex") };
    let hostProbe;
    try { hostProbe = await probeControl("bridge", "host.docker.internal", control.port, hostToken); }
    catch (error) { hostProbe = { code: "PROBE_ERROR", error: String(error.message ?? error) }; }
    const hostPassed = hostProbe.value === hostToken && net.isIP(hostProbe.remote_address ?? "") === 4;
    report.host_control.resolved_address = hostProbe.remote_address ?? null;
    report.checks.push({ source: "control-client", target: "host-control", expected: "reachable", passed: hostPassed,
      code: hostProbe.code, reason: hostPassed ? undefined : "普通控制容器未收到宿主机回环服务的校验值" });
    if (hostPassed) {
      const target = { name: "host-control", host: hostProbe.remote_address, port: control.port, kind: "host" };
      report.targets.push(target);
      await checkBlocked(sources, target);
    } else {
      for (const source of Object.keys(sources)) report.checks.push({ source, target: "host-control", expected: "blocked", passed: false,
        classification: "not_verified", reason: "宿主机正向对照不可用" });
    }
    for (const target of METADATA_TARGETS) await checkBlocked(sources, target);

    for (const [index, subnet] of subnets.entries()) {
      const name = controlProject + "-private-" + index;
      const token = randomBytes(12).toString("hex");
      controlAttempted = true;
      await invoke(["network", "create", ...labels, "--subnet", subnet, name]);
      const serverName = name + "-server";
      const script = "require('node:net').createServer(s=>{s.on('error',()=>{});s.end(" + JSON.stringify(token + "\n") + ")}).listen(8790,'0.0.0.0')";
      await invoke(["run", "-d", "--name", serverName, ...bounds, ...labels, "--network", name, CANDIDATE_IMAGE, "node", "-e", script]);
      const attached = JSON.parse(await invoke(["container", "inspect", "--format", "{{json .NetworkSettings.Networks}}", serverName]));
      const host = attached[name]?.IPAddress;
      if (net.isIP(host ?? "") !== 4) throw new Error("无法读取私网对照服务地址");
      let positive;
      for (let attempt = 0; attempt < 3; attempt++) {
        positive = await probeControl(name, host, 8790, token);
        if (positive.value === token) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const passed = positive.value === token;
      const target = { name: ["private-10", "private-172", "private-192"][index], host, port: 8790, kind: "rfc1918" };
      report.targets.push(target);
      report.checks.push({ source: "control-client", target: target.name, expected: "reachable", passed, code: positive.code,
        token_sha256: createHash("sha256").update(token).digest("hex") });
      await checkBlocked(sources, target, passed);
    }
    const latestNetwork = JSON.parse(await invoke(["network", "inspect", demoNetwork.Id]))[0];
    const latestSources = await loadDemoSources(invoke, project, latestNetwork, report.candidate_image_id);
    if (JSON.stringify(sources) !== JSON.stringify(latestSources)) throw new Error("验收期间 Demo 来源发生变化");
    report.status = report.checks.length === 20 && report.checks.every((item) => item.passed) ? "passed" : "failed";
  } catch (error) {
    report.error = String(error.message ?? error);
  } finally {
    if (controlAttempted) {
      try {
        const items = await resources.list();
        await resources.assertOwned(items);
        if (items.some((item) => item.type === "volume")) throw new Error("对照资源不应包含卷，停止清理");
        for (const { type, id } of items.filter((item) => item.type === "container")) await invoke([type, "rm", "-f", id]);
        for (const { type, id } of items.filter((item) => item.type === "network")) await invoke([type, "rm", id]);
        if ((await resources.list()).length) throw new Error("仍有未清理的网络对照资源");
        report.cleanup = { status: "removed", resource_count: items.length };
      } catch (error) {
        report.cleanup = { status: "failed", error: String(error.message ?? error) };
        report.status = "failed";
      }
    }
    try { await control?.close(); }
    catch (error) { report.cleanup = { status: "failed", error: String(error.message ?? error) }; report.status = "failed"; }
    report.finished_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  }
  return { exitCode: report.status === "passed" ? 0 : 1, report, evidencePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { project: { type: "string" }, evidence: { type: "string" }, help: { type: "boolean" } } });
    if (values.help) console.log("用法：node scripts/verify-demo-network.mjs --project zhiliao-demo-verify-名称 [--evidence 路径]");
    else {
      const result = await verifyDemoNetwork({ project: values.project, evidencePath: values.evidence },
        { onProgress: (event) => console.log(JSON.stringify(event)) });
      console.log(JSON.stringify({ status: result.report.status, evidence: result.evidencePath, cleanup: result.report.cleanup }, null, 2));
      process.exitCode = result.exitCode;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
