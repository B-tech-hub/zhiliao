import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyDemoDeployment } from "../../scripts/verify-demo-runtime.mjs";

const temporaryDirs = new Set<string>();
const runLabel = "io.zhiliao.demo-verify.run";
const projectLabel = "com.docker.compose.project";

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temporaryDirs) {
    if (!fs.existsSync(dir)) continue;
    const resolved = fs.realpathSync(dir);
    if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith("zhiliao-demo-")) {
      throw new Error("测试临时目录超出清理边界");
    }
    fs.rmSync(resolved, { recursive: true });
  }
  temporaryDirs.clear();
});

function fixture({
  existingType = "", nameOnly = false, startFailure = false, nginxFailure = false,
  cleanupFailure = false, foreignOwner = false, foreignVolume = false,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-demo-runtime-test-"));
  temporaryDirs.add(dir);
  const state = { created: false, work: "", project: "", values: {} as Record<string, string> };
  const docker = vi.fn((args: string[], execution: { env: NodeJS.ProcessEnv }) => {
    expect(Object.keys(execution.env).filter((key) => /^(DEMO_|COMPOSE_)/i.test(key))).toEqual([]);
    if (args[0] === "version") return "28.4.0";
    if (args[0] === "compose" && args[1] === "version") return "2.39.4";
    if (args[0] === "image") return "sha256:" + "a".repeat(64);
    const type = args[0] === "ps" ? "container" : args[0];
    if (args[0] === "ps" || args[1] === "ls") {
      const filter = args[args.indexOf("--filter") + 1];
      if (!state.created) return existingType === type && (!nameOnly || filter.startsWith("name=")) ? "existing-resource" : "";
      return Array.from({ length: type === "network" ? 2 : 3 }, (_, index) => type + "-" + index).join("\n");
    }
    if (args[1] === "inspect") {
      return JSON.stringify({ [runLabel]: foreignOwner ? "another-run" : state.values.DEMO_VERIFY_RUN_ID, [projectLabel]: state.project });
    }
    if (args[0] !== "compose") throw new Error("意外的 Docker 命令");
    state.project = args[args.indexOf("-p") + 1];
    state.work = args[args.indexOf("--project-directory") + 1];
    temporaryDirs.add(state.work);
    const envFile = args[args.indexOf("--env-file") + 1];
    state.values = Object.fromEntries(fs.readFileSync(envFile, "utf8").trim().split("\n").map((line) => line.split("=")));
    if (args.includes("config")) {
      const labels = { [runLabel]: state.values.DEMO_VERIFY_RUN_ID };
      return JSON.stringify({
        services: {
          app: {
            labels, image: "zhiliao-demo-verify:story-2-2", networks: { demo_net: null },
            environment: { DEMO_MODE: "1", LLM_BASE_URL: "http://mockllm:8787/v1", LLM_API_KEY: "demo", LLM_MODEL: "mock", SESSION_SECRET: "a".repeat(32) },
            cpus: 1, mem_limit: "805306368", pids_limit: 128, read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"],
            logging: { options: { "max-size": "10m", "max-file": "3" } },
            volumes: ["db", "uploads", "notes"].map((key) => ({ type: "volume", source: "demo_" + key, target: "/data/" + key })),
          },
          mockllm: { labels, image: "zhiliao-demo-verify:story-2-2", networks: { demo_net: null }, cpus: 0.5, mem_limit: "268435456", pids_limit: 64, read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], logging: { options: { "max-size": "5m", "max-file": "2" } } },
          ingress: {
            labels, image: "nginx:1.30.4-alpine@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c", networks: { demo_net: null, ingress_net: null },
            cpus: 0.25, mem_limit: "134217728", pids_limit: 64, read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], logging: { options: { "max-size": "5m", "max-file": "2" } },
            ports: [{ host_ip: "127.0.0.1", published: state.values.DEMO_VERIFY_PORT, target: 8080 }],
            volumes: [{ source: path.join(state.work, "nginx", "demo.conf"), read_only: true }],
          },
        },
        volumes: Object.fromEntries(["db", "uploads", "notes"].map((key) => [
          "demo_" + key, { name: foreignVolume ? "production_" + key : state.project + "_demo_" + key, labels },
        ])),
        networks: {
          demo_net: { name: state.project + "-net", labels },
          ingress_net: { name: state.project + "-ingress", labels },
        },
      });
    }
    if (args.includes("up")) {
      state.created = true;
      if (startFailure) throw new Error("fixture startup failed");
      return "";
    }
    if (args.includes("port")) return "127.0.0.1:" + state.values.DEMO_VERIFY_PORT;
    if (args.includes("exec")) {
      if (nginxFailure) throw new Error("fixture nginx failed");
      return "syntax is ok";
    }
    if (args.includes("down")) {
      if (cleanupFailure) throw new Error("fixture cleanup failed");
      state.created = false;
      return "";
    }
    throw new Error("未覆盖的 Docker 命令");
  });
  const checkHttp = vi.fn(async () => ({
    health: 200, oversize: 413, default_oversize: 413, upload_oversize: 413,
    import_midsize: 401, upload_midsize: 401, oversize_response_ms: 2, sent_body_bytes: 1,
  }));
  const checkSse = vi.fn(async () => ({ completed: { done: true }, cancellation: { cancelled: true }, health_after_cancel: 200 }));
  const checkNetwork = vi.fn(async ({ project, evidencePath }: { project: string; evidencePath: string }) => {
    const controls = ["host-control", "private-10", "private-172", "private-192"];
    const blocked = [...controls, "metadata-169.254.169.254", "metadata-169.254.170.2"];
    const checks = [
      ...[["app", "mockllm"], ["app", "ingress"], ["mockllm", "app"], ["mockllm", "ingress"]]
        .map(([source, target]) => ({ source, target, expected: "reachable", passed: true })),
      ...controls.map((target) => ({ source: "control-client", target, expected: "reachable", passed: true })),
      ...blocked.flatMap((target) => ["app", "mockllm"].map((source) => ({ source, target, expected: "blocked", passed: true }))),
    ];
    const report = {
      story: "2.2", project, engine: "28.4.0", candidate_image_id: "sha256:" + "a".repeat(64),
      status: "passed", run_id: "c".repeat(32), control_project: "zhiliao-demo-network-verify-" + "c".repeat(12),
      sources: Object.fromEntries(["app", "mockllm"].map((service) => [service, {
        run_id: state.values.DEMO_VERIFY_RUN_ID, image: "sha256:" + "a".repeat(64),
      }])),
      input_sha256: Object.fromEntries([
        "scripts/verify-demo-network.mjs", "scripts/demo-verification-utils.mjs", "docker-compose.demo.yml", "docker-compose.demo.verify.yml",
      ].map((file) => [file, createHash("sha256").update(fs.readFileSync(file)).digest("hex")])),
      checks, cleanup: { status: "removed" },
    };
    fs.writeFileSync(evidencePath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    return { exitCode: 0, report, evidencePath };
  });
  return { state, docker, checkHttp, checkSse, checkNetwork, evidencePath: path.join(dir, "report.json") };
}

describe("Demo 运行验收的失败与清理边界（Docker 命令夹具）", () => {
  it("等待健康、使用指定端口，并把所选检查及清理结果写入独立证据", async () => {
    vi.stubEnv("DEMO_SESSION_SECRET", "production-secret-fixture");
    vi.stubEnv("DEMO_VERIFY_PORT", "9999");
    vi.stubEnv("COMPOSE_FILE", "production-compose.yml");
    const f = fixture();
    const result = await verifyDemoDeployment({ port: 3376, evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({ port: 3376, status: "passed", cleanup: { status: "removed" }, checks: { sse: "not_run" } });
    expect(f.checkHttp).toHaveBeenCalledWith("http://127.0.0.1:3376", expect.objectContaining({ timeoutMs: 10000, signal: expect.any(AbortSignal) }));
    expect(f.checkSse).not.toHaveBeenCalled();
    expect(f.checkNetwork).not.toHaveBeenCalled();
    expect(result.report.checks.network).toBe("not_run");
    const up = f.docker.mock.calls.find(([args]) => args.includes("up"))![0];
    expect(up).toEqual(expect.arrayContaining(["--no-build", "--pull", "never", "--wait", "--wait-timeout", "120"]));
    expect(fs.existsSync(f.state.work)).toBe(false);
    expect(JSON.parse(fs.readFileSync(f.evidencePath, "utf8"))).toMatchObject({ status: "passed", cleanup: { status: "removed" } });
    expect(process.env.DEMO_SESSION_SECRET).toBe("production-secret-fixture");
  });

  it("HTTP 状态异常时返回失败，并清理本次已创建资源", async () => {
    const f = fixture();
    f.checkHttp.mockResolvedValue({
      health: 503, oversize: 413, default_oversize: 413, upload_oversize: 413,
      import_midsize: 401, upload_midsize: 401, oversize_response_ms: 1, sent_body_bytes: 1,
    });
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({ status: "failed", failed_stage: "http", cleanup: { status: "removed" } });
    expect(f.state.created).toBe(false);
  });

  it.each(["startup", "nginx"] as const)("%s 失败不会被后续清理的成功状态覆盖", async (stage) => {
    const f = fixture({ startFailure: stage === "startup", nginxFailure: stage === "nginx" });
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({ failed_stage: stage, cleanup: { status: "removed" } });
  });

  it.each(["container", "network", "volume"])("已有 %s 时不启动、不清理", async (existingType) => {
    const f = fixture({ existingType });
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    expect(f.docker.mock.calls.some(([args]) => args.includes("up") || args.includes("down"))).toBe(false);
    expect(f.state.work).toBe("");
  });

  it("没有 Compose 标签的同名卷也会阻止启动", async () => {
    const f = fixture({ existingType: "volume", nameOnly: true });
    expect((await verifyDemoDeployment({ evidencePath: f.evidencePath }, f)).exitCode).toBe(1);
    expect(f.docker.mock.calls.some(([args]) => args.includes("up") || args.includes("down"))).toBe(false);
  });

  it("配置指向正式卷名时，在启动前拒绝", async () => {
    const f = fixture({ foreignVolume: true });
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    expect(f.docker.mock.calls.some(([args]) => args.includes("up") || args.includes("down"))).toBe(false);
    expect(fs.existsSync(f.state.work)).toBe(false);
  });

  it("运行标识不匹配时停止清理并保留诊断目录", async () => {
    const f = fixture({ foreignOwner: true });
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report.cleanup.status).toBe("failed");
    expect(f.docker.mock.calls.some(([args]) => args.includes("down"))).toBe(false);
    expect(fs.existsSync(f.state.work)).toBe(true);
    expect(f.checkHttp).not.toHaveBeenCalled();
  });

  it("即使检查通过，清理失败仍返回非零并保留恢复配置", async () => {
    const f = fixture({ cleanupFailure: true });
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath, includeNetwork: true }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({ status: "failed", cleanup: { status: "failed" } });
    expect(fs.existsSync(path.join(f.state.work, "demo.env"))).toBe(true);
  });

  it("显式保留资源时提供恢复参数，证据不包含密码或会话密钥", async () => {
    const f = fixture();
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath, keepResources: true, includeSse: true }, f);
    expect(result.exitCode).toBe(0);
    expect(result.report.cleanup.status).toBe("retained");
    expect(f.checkSse).toHaveBeenCalledTimes(1);
    expect(f.docker.mock.calls.some(([args]) => args.includes("down"))).toBe(false);
    const evidence = fs.readFileSync(f.evidencePath, "utf8");
    expect(evidence).not.toContain(f.state.values.DEMO_PASSWORD);
    expect(evidence).not.toContain(f.state.values.DEMO_SESSION_SECRET);
  });

  it("SSE 检查失败也保留失败结论并清理本次资源", async () => {
    const f = fixture();
    f.checkSse.mockRejectedValue(new Error("fixture stream stalled"));
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath, includeSse: true, includeNetwork: true }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({ failed_stage: "sse", cleanup: { status: "removed" } });
    expect(f.checkNetwork).not.toHaveBeenCalled();
  });

  it("等待 HTTP 和 SSE 后异步完成网络验收，再关联证据并清理 Demo", async () => {
    const f = fixture();
    const network = f.checkNetwork.getMockImplementation()!;
    f.checkNetwork.mockImplementation(async (options) => {
      expect(f.checkHttp).toHaveBeenCalledTimes(1);
      expect(f.checkSse).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(f.state.created).toBe(true);
      return network(options);
    });
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath, includeSse: true, includeNetwork: true }, f);
    const networkPath = path.join(path.dirname(f.evidencePath), "report-network.json");
    expect(result.exitCode).toBe(0);
    expect(result.report.checks.network).toMatchObject({
      status: "passed", observed_status: "passed", check_count: 20, evidence: networkPath,
      cleanup: { status: "removed" }, evidence_sha256: createHash("sha256").update(fs.readFileSync(networkPath)).digest("hex"),
    });
    expect(result.report.limitations.join()).toContain("业务卷硬配额");
    expect(f.state.created).toBe(false);
    expect(fs.existsSync(f.state.work)).toBe(false);
    expect(f.checkNetwork.mock.calls[0][0].project).toBe(f.state.project);
  });

  it.each([
    "非零退出", "状态失败", "缺少检查", "检查失败", "重复路径", "目标矩阵缺项", "来源不一致", "输入变化", "控制清理失败", "缺少报告", "落盘结果不一致", "证据缺失",
  ])("网络%s 时保留失败结论并清理本次 Demo", async (fault) => {
    const f = fixture();
    const network = f.checkNetwork.getMockImplementation()!;
    f.checkNetwork.mockImplementation(async (options) => {
      const result = await network(options);
      if (fault === "非零退出") result.exitCode = 1;
      if (fault === "状态失败") result.report.status = "failed";
      if (fault === "缺少检查") result.report.checks.pop();
      if (fault === "检查失败") result.report.checks[0].passed = false;
      if (fault === "重复路径") result.report.checks[1] = result.report.checks[0];
      if (fault === "目标矩阵缺项") result.report.checks[0].target = "unexpected-target";
      if (fault === "来源不一致") result.report.sources.app.run_id = "another-run";
      if (fault === "输入变化") result.report.input_sha256["docker-compose.demo.yml"] = "changed";
      if (fault === "控制清理失败") result.report.cleanup.status = "failed";
      if (fault === "落盘结果不一致") fs.writeFileSync(result.evidencePath, "{}");
      else if (fault === "证据缺失") fs.unlinkSync(result.evidencePath);
      else fs.writeFileSync(result.evidencePath, JSON.stringify(result.report));
      if (fault === "缺少报告") Reflect.deleteProperty(result, "report");
      return result;
    });
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath, includeNetwork: true }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({ failed_stage: "network", checks: { network: { status: "failed" } }, cleanup: { status: "removed" } });
    expect(f.state.created).toBe(false);
    expect(fs.existsSync(f.state.work)).toBe(false);
  });

  it("网络调用抛错时不泄露本轮凭据，并进入 Demo 清理", async () => {
    const f = fixture();
    f.checkNetwork.mockImplementation(async () => { throw new Error(f.state.values.DEMO_PASSWORD + " " + f.state.values.DEMO_SESSION_SECRET); });
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath, includeNetwork: true }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({ failed_stage: "network", cleanup: { status: "removed" } });
    const content = fs.readFileSync(f.evidencePath, "utf8");
    expect(content).not.toContain(f.state.values.DEMO_PASSWORD);
    expect(content).not.toContain(f.state.values.DEMO_SESSION_SECRET);
  });

  it("网络证据写入失败时仍清理 Demo 并保存运行失败报告", async () => {
    const f = fixture();
    const network = f.checkNetwork.getMockImplementation()!;
    f.checkNetwork.mockImplementation(async (options) => {
      fs.mkdirSync(options.evidencePath);
      return network(options);
    });
    const result = await verifyDemoDeployment({ evidencePath: f.evidencePath, includeNetwork: true }, f);
    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({ failed_stage: "network", cleanup: { status: "removed" } });
    expect(f.state.created).toBe(false);
  });

  it("运行报告写入期间出现冲突时先完成清理，不覆盖外来文件", async () => {
    const f = fixture();
    const network = f.checkNetwork.getMockImplementation()!;
    f.checkNetwork.mockImplementation(async (options) => {
      const result = await network(options);
      fs.writeFileSync(f.evidencePath, "concurrent evidence");
      return result;
    });
    await expect(verifyDemoDeployment({ evidencePath: f.evidencePath, includeNetwork: true }, f)).rejects.toThrow();
    expect(f.state.created).toBe(false);
    expect(fs.existsSync(f.state.work)).toBe(false);
    expect(fs.readFileSync(f.evidencePath, "utf8")).toBe("concurrent evidence");
  });

  it("网络证据重名时在 Docker 操作之前拒绝", async () => {
    const f = fixture();
    const networkPath = path.join(path.dirname(f.evidencePath), "report-network.json");
    fs.writeFileSync(networkPath, "existing network evidence");
    await expect(verifyDemoDeployment({ evidencePath: f.evidencePath, includeNetwork: true }, f)).rejects.toThrow("拒绝覆盖");
    expect(f.docker).not.toHaveBeenCalled();
    expect(f.checkNetwork).not.toHaveBeenCalled();
    expect(fs.readFileSync(networkPath, "utf8")).toBe("existing network evidence");
  });

  it("HTTP 检查期间收到 SIGINT 会 down 并返回非零", async () => {
    const originalOn = process.on.bind(process);
    const originalOff = process.off.bind(process);
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    const onSpy = vi.spyOn(process, "on").mockImplementation((event, listener) => {
      const name = String(event);
      if (name === "SIGINT" || name === "SIGTERM") {
        const set = handlers.get(name) ?? new Set();
        set.add(listener as (...args: unknown[]) => void);
        handlers.set(name, set);
        return process;
      }
      return originalOn(event, listener as never);
    });
    const offSpy = vi.spyOn(process, "off").mockImplementation((event, listener) => {
      const name = String(event);
      handlers.get(name)?.delete(listener as (...args: unknown[]) => void);
      if (name === "SIGINT" || name === "SIGTERM") return process;
      return originalOff(event, listener as never);
    });
    try {
      const f = fixture();
      f.checkHttp.mockImplementation(async (_url, options?: { signal?: AbortSignal }) => {
        for (const handler of [...(handlers.get("SIGINT") ?? [])]) handler("SIGINT");
        expect(options?.signal?.aborted).toBe(true);
        throw new Error("验收被中断");
      });
      const result = await verifyDemoDeployment({ evidencePath: f.evidencePath }, f);
      expect(result.exitCode).toBe(1);
      expect(result.report.failed_stage).toBe("http");
      expect(f.docker.mock.calls.some(([args]) => args.includes("down"))).toBe(true);
      expect(f.state.created).toBe(false);
    } finally {
      onSpy.mockRestore();
      offSpy.mockRestore();
    }
  });

  it("拒绝覆盖已有证据", async () => {
    const f = fixture();
    fs.writeFileSync(f.evidencePath, "existing evidence");
    await expect(verifyDemoDeployment({ evidencePath: f.evidencePath }, f)).rejects.toThrow("拒绝覆盖");
    expect(f.docker).not.toHaveBeenCalled();
    expect(fs.readFileSync(f.evidencePath, "utf8")).toBe("existing evidence");
  });

  it("CLI 对非法 project 返回非零，参数验证发生在 Docker 操作之前", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-demo-runtime.mjs", "--include-network", "--project", "production"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 5000, windowsHide: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("project");
  });

  it.skipIf(process.platform !== "win32")("Windows PowerShell 能解析中文入口并保留 Node 的失败退出码", () => {
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", path.resolve("scripts/verify-demo-runtime.ps1"), "-Project", "production",
    ], { encoding: "utf8", timeout: 10000, windowsHide: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("zhiliao-demo-verify");
    expect(result.stderr).not.toContain("ParserError");
  });

  it.skipIf(process.platform !== "win32")("PowerShell 将网络选项作为独立参数传递给 Node", () => {
    const f = fixture();
    const directory = path.dirname(f.evidencePath);
    const script = path.join(directory, "verify-demo-runtime.ps1");
    fs.copyFileSync("scripts/verify-demo-runtime.ps1", script);
    fs.writeFileSync(path.join(directory, "verify-demo-runtime.mjs"), "console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 7;\n");
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
      "-Port", "3376", "-IncludeSse", "-IncludeNetwork", "-EvidencePath", path.join(directory, "含 空格.json"),
    ], { encoding: "utf8", timeout: 10000, windowsHide: true });
    expect(result.status).toBe(7);
    expect(JSON.parse(result.stdout)).toEqual([
      "--port", "3376", "--startup-timeout", "120", "--request-timeout", "10",
      "--include-sse", "--include-network", "--evidence", path.join(directory, "含 空格.json"),
    ]);
  });
});
