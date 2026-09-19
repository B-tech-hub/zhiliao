import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProbeScript, chooseControlSubnets, evaluateNetworkProbe, listenControlServer, verifyDemoNetwork } from "../../scripts/verify-demo-network.mjs";
import { removeOwnedTemp, runProcess } from "../../scripts/demo-verification-utils.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) removeOwnedTemp(directory, "zhiliao-demo-network-test-");
});

function fixture({ hostUnavailable = false, privateUnavailable = false, foreign = false, wrongSource = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-demo-network-test-"));
  directories.push(directory);
  const project = "zhiliao-demo-verify-fixture";
  const image = "sha256:" + "a".repeat(64);
  const demoLabels = { "com.docker.compose.project": project, "io.zhiliao.demo-verify.run": "demo-run" };
  const network = { Id: "demo-net", Name: project + "-net", Internal: true, Labels: demoLabels,
    Options: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" }, IPAM: { Config: [{ Subnet: "172.23.0.0/16" }] } };
  const assets = new Map<string, { type: string; network?: string }>();
  const calls: string[][] = [];
  let labels: Record<string, string> = {};
  let closed = false;
  const docker = async (args: string[], execution: { input?: string }) => {
    calls.push(args);
    if (args[0] === "version") return "28.4.0";
    if (args[0] === "info") return "Docker Desktop";
    if (args[0] === "image") return image;
    if (args[0] === "ps" && args.includes("-q")) {
      return args.some((item) => item.endsWith("service=app")) ? "app-id" : "mockllm-id";
    }
    if (args[0] === "network" && args[1] === "ls" && !args.includes("--filter")) return "demo-net";
    if (args[0] === "ps" || args[1] === "ls") {
      const type = args[0] === "ps" ? "container" : args[0];
      return [...assets.entries()].filter(([, item]) => item.type === type).map(([id]) => id).join("\n");
    }
    if (args[1] === "inspect") {
      if (args.includes("{{json .Config.Labels}}") || args.includes("{{json .Labels}}")) {
        return JSON.stringify(foreign ? { ...labels, "io.zhiliao.demo-network-verify.run": "foreign" } : labels);
      }
      if (args[0] === "network") return JSON.stringify([network]);
      const id = args.at(-1)!;
      if (args.includes("{{json .NetworkSettings.Networks}}")) return JSON.stringify({ [assets.get(id)!.network!]: { IPAddress: "10.230.250.2" } });
      return JSON.stringify({ id, image, labels: demoLabels, state: { Running: true, Health: { Status: "healthy" } },
        networks: { [network.Name]: { NetworkID: wrongSource ? "foreign-net" : "demo-net" } } });
    }
    if (args[1] === "rm") { assets.delete(args.at(-1)!); return ""; }
    if (args[1] === "create" || args[0] === "run") {
      labels = Object.fromEntries(args.flatMap((item, i) => item === "--label" ? [args[i + 1].split("=")] : []));
      if (args[1] === "create") { assets.set(args.at(-1)!, { type: "network" }); return args.at(-1)!; }
      if (args.includes("-d")) {
        assets.set(args[args.indexOf("--name") + 1], { type: "container", network: args[args.indexOf("--network") + 1] });
        return "server-id";
      }
    }
    const script = execution.input ?? "";
    if (script.startsWith("fetch(")) return JSON.stringify({ status: 200 });
    if (script.startsWith("console.log(require")) return "Iface Destination Gateway Flags\neth0 000017AC 00000000 0001";
    const payload = JSON.parse(script.slice("const probeInput=".length, script.indexOf(";\n")));
    if (args[0] === "run") {
      const host = payload.host === "host.docker.internal";
      return JSON.stringify({ token: payload.token, value: (host && hostUnavailable) || (!host && privateUnavailable) ? "wrong" : payload.token,
        remote_address: host ? "192.168.65.254" : payload.host, code: host && hostUnavailable ? "ETIMEDOUT" : undefined });
    }
    return JSON.stringify({ token: payload.token, code: "ENETUNREACH", route_available: false, elapsed_ms: 1 });
  };
  return { project, calls, assets, docker, readHostRoutes: async () => ["192.168.1.0/24"],
    controlServer: async () => ({ port: 5678, close: async () => { closed = true; } }),
    isClosed: () => closed, evidencePath: path.join(directory, "report.json") };
}

describe("Demo 网络验收工具", () => {
  it("单纯连接超时不能证明路由或策略阻断", () => {
    expect(evaluateNetworkProbe({ code: "ETIMEDOUT" }).passed).toBe(false);
    expect(evaluateNetworkProbe({ code: "EHOSTUNREACH", route_available: true }).passed).toBe(false);
    expect(evaluateNetworkProbe({ blocked: true }).passed).toBe(false);
  });

  it("不会把 ECONNREFUSED 或实际连接成功误判为隔离通过", () => {
    expect(evaluateNetworkProbe({ code: "ECONNREFUSED" })).toMatchObject({ classification: "reached-refused", passed: false });
    expect(evaluateNetworkProbe({ connected: true, code: "ENETUNREACH" }).passed).toBe(false);
  });

  it("保留无路由证据，EHOSTUNREACH 需要路由对照", () => {
    expect(evaluateNetworkProbe({ code: "ENETUNREACH", route_available: false }).passed).toBe(true);
    expect(evaluateNetworkProbe({ code: "EHOSTUNREACH", route_available: false }).passed).toBe(true);
    expect(evaluateNetworkProbe({ code: "EHOSTUNREACH" }).passed).toBe(false);
  });

  it("等待异步探针时，本机控制服务仍能返回本次随机校验值", async () => {
    const token = "local-control-fixture";
    const control = await listenControlServer(token);
    try {
      const output = await runProcess(process.execPath, [], { input: buildProbeScript("127.0.0.1", control.port, token, true) });
      expect(JSON.parse(output)).toMatchObject({ token, connected: true, value: token });
    } finally { await control.close(); }
  });

  it("三个私网子网避开 Docker 网络及宿主机路由", () => {
    const selected = chooseControlSubnets(["0.0.0.0/0", "10.230.0.0/16", "172.16.0.0/16", "192.168.230.0/24"]);
    expect(selected).toHaveLength(3);
  });

  it("整个私网地址段被占用时拒绝创建对照网络", () => {
    expect(() => chooseControlSubnets(["10.0.0.0/8"])).toThrow("冲突");
  });

  it("真实探针区分连接拒绝与网络不可达", async () => {
    const control = await listenControlServer("unused");
    const port = control.port;
    await control.close();
    const output = await runProcess(process.execPath, [], { input: buildProbeScript("127.0.0.1", port, "refused-probe") });
    expect(evaluateNetworkProbe(JSON.parse(output))).toMatchObject({ classification: "reached-refused", passed: false });
  });

  it("允许路径、四个有效正向对照及全部负向路径通过后才成功", async () => {
    const f = fixture();
    const result = await verifyDemoNetwork({ project: f.project, evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(0);
    expect(result.report.checks).toHaveLength(20);
    expect(result.report.checks.filter((item) => item.source === "control-client")).toHaveLength(4);
    expect(result.report.cleanup.status).toBe("removed");
    expect(f.assets.size).toBe(0);
    expect(f.isClosed()).toBe(true);
    expect(f.calls.some((args) => args.includes("--add-host"))).toBe(false);
  });

  it.each([{ hostUnavailable: true }, { privateUnavailable: true }])("缺少正向对照时不把目标不可达算作通过 %j", async (failure) => {
    const f = fixture(failure);
    const result = await verifyDemoNetwork({ project: f.project, evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    const target = failure.hostUnavailable ? "host-control" : "private-10";
    expect(result.report.checks.filter((item) => item.target === target).every((item) => !item.passed)).toBe(true);
    expect(result.report.cleanup.status).toBe("removed");
  });

  it("归属不匹配时保留控制资源并关闭本机临时服务", async () => {
    const f = fixture({ foreign: true });
    const result = await verifyDemoNetwork({ project: f.project, evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report.cleanup.status).toBe("failed");
    expect(f.calls.some((args) => args[1] === "rm")).toBe(false);
    expect(f.isClosed()).toBe(true);
  });

  it("来源网络不符时不启动对照资源", async () => {
    const f = fixture({ wrongSource: true });
    const result = await verifyDemoNetwork({ project: f.project, evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    expect(f.calls.some((args) => args[0] === "run" || args[1] === "create")).toBe(false);
  });

  it("必须显式指定已有验收实例且不允许遗漏来源", async () => {
    await expect(verifyDemoNetwork()).rejects.toThrow("--project");
    await expect(verifyDemoNetwork({ project: "zhiliao-demo-verify-fixture", services: ["app"] })).rejects.toThrow("同时检查");
  });
});
