import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const composePath = path.resolve(process.cwd(), "docker-compose.demo.yml");
const version = spawnSync("docker", ["compose", "version", "--short"], {
  encoding: "utf8",
  timeout: 10_000,
  windowsHide: true,
});

// 默认允许无 Docker 的开发环境跳过；发布门禁设置 REQUIRE_DOCKER_COMPOSE=1 后不得跳过。
const requireCompose = process.env.REQUIRE_DOCKER_COMPOSE === "1";
describe.skipIf(version.status !== 0 && !requireCompose)("Docker Compose 真实环境文件隔离", () => {
  let fixtureDir: string;
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(?:DEMO_|COMPOSE_)/i.test(key)) delete environment[key];
  }

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-demo-compose-"));
    fs.copyFileSync(composePath, path.join(fixtureDir, "docker-compose.demo.yml"));
    fs.mkdirSync(path.join(fixtureDir, "nginx"));
    fs.copyFileSync(path.resolve(process.cwd(), "nginx/demo.conf"), path.join(fixtureDir, "nginx/demo.conf"));
    fs.copyFileSync(path.resolve(process.cwd(), "docker-compose.demo.verify.yml"), path.join(fixtureDir, "docker-compose.demo.verify.yml"));
    // 全部是测试值，不读取工作区或真实实例的 .env。
    fs.writeFileSync(path.join(fixtureDir, ".env"), [
      "DEMO_PASSWORD=production-fixture-password",
      "DEMO_SESSION_SECRET=production-fixture-secret-0123456789",
      "COMPOSE_PROJECT_NAME=production-fixture",
      "DEMO_VERIFY_PORT=9999",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureDir, "demo.env"), [
      "DEMO_PASSWORD=demo-fixture-password",
      "DEMO_SESSION_SECRET=demo-fixture-secret-0123456789",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureDir, "missing-secret.env"), "DEMO_PASSWORD=demo\n");
    fs.writeFileSync(path.join(fixtureDir, "custom-port.env"), [
      "DEMO_PASSWORD=demo-fixture-password",
      "DEMO_SESSION_SECRET=demo-fixture-secret-0123456789",
      "DEMO_VERIFY_PORT=3376",
      "DEMO_VERIFY_RUN_ID=fixture-run-123",
      "",
    ].join("\n"));
  });

  afterAll(() => {
    if (!fixtureDir) return;
    const resolved = fs.realpathSync(fixtureDir);
    if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith("zhiliao-demo-compose-")) {
      throw new Error("测试目录超出临时目录边界，停止清理");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  function tmpfsPaths(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as { target?: string };
          return String(record.target ?? JSON.stringify(item));
        }
        return String(item);
      });
    }
    if (value && typeof value === "object") return Object.keys(value as object);
    return [];
  }

  function commandText(value: unknown): string {
    return Array.isArray(value) ? value.map(String).join(" ") : String(value ?? "");
  }

  function resolveConfig(envFile?: string, withCandidate = false) {
    return spawnSync("docker", [
      "compose",
      ...(envFile ? ["--env-file", envFile] : []),
      "-p", "zhiliao-demo-test",
      "-f", "docker-compose.demo.yml",
      ...(withCandidate ? ["-f", "docker-compose.demo.verify.yml"] : []),
      "config", "--format", "json",
    ], {
      cwd: fixtureDir,
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
  }

  it("单独复制后可解析，且显式环境文件不会混入同目录正式配置", () => {
    const result = resolveConfig("demo.env");
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const compose = JSON.parse(result.stdout);

    expect(compose.name).toBe("zhiliao-demo-test");
    expect(compose.services.app.environment.APP_PASSWORD).toBe("demo-fixture-password");
    expect(compose.services.app.environment.SESSION_SECRET).toBe("demo-fixture-secret-0123456789");
    expect(result.stdout).not.toContain("production-fixture");
    expect(compose.services.app.environment.LLM_BASE_URL).toBe("http://mockllm:8787/v1");
    expect(compose.services.ingress.ports).toHaveLength(1);
    expect(compose.services.ingress.ports[0]).toMatchObject({ host_ip: "127.0.0.1", target: 8080, published: "3210" });
    expect(compose.services.app.ports).toBeUndefined();
    expect(compose.services.mockllm.ports).toBeUndefined();
    expect(compose.services.app.volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "volume", source: "demo_db", target: "/data/db" }),
      expect.objectContaining({ type: "volume", source: "demo_uploads", target: "/data/uploads" }),
      expect.objectContaining({ type: "volume", source: "demo_notes", target: "/data/notes" }),
    ]));
    expect(compose.services.app.volumes).toHaveLength(3);
    expect(compose.volumes.demo_db.name).toBe("zhiliao-demo-test_demo_db");
    expect(compose.networks.demo_net.internal).toBe(true);
    // Compose 展开时可能省略默认的 false，入口网必须保持非内部网络。
    expect([false, undefined]).toContain(compose.networks.ingress_net.internal);
    expect(Object.keys(compose.services.app.networks)).toEqual(["demo_net"]);
    expect(Object.keys(compose.services.mockllm.networks)).toEqual(["demo_net"]);
    expect(Object.keys(compose.services.ingress.networks).sort()).toEqual(["demo_net", "ingress_net"]);
    expect(compose.networks.demo_net.name).toBe("zhiliao-demo-test-net");
    expect(compose.networks.demo_net.driver_opts["com.docker.network.bridge.gateway_mode_ipv4"]).toBe("isolated");
    expect(compose.networks.ingress_net.name).toBe("zhiliao-demo-test-ingress");
    expect(compose.services.app.read_only).toBe(true);
    expect(compose.services.mockllm.read_only).toBe(true);
    expect(compose.services.ingress.read_only).toBe(true);
    expect(compose.services.app.cap_drop).toEqual(expect.arrayContaining(["ALL"]));
    expect(tmpfsPaths(compose.services.app.tmpfs).some((item) => item.includes("/tmp"))).toBe(true);
    expect(compose.services.app.depends_on.mockllm.condition).toBe("service_healthy");
    expect(compose.services.ingress.depends_on.app.condition).toBe("service_healthy");
    expect(commandText(compose.services.app.healthcheck.test)).toContain("/api/healthz");
    expect(commandText(compose.services.mockllm.healthcheck.test)).toContain("8787");
    expect(commandText(compose.services.ingress.healthcheck.test)).toContain("/api/healthz");
  });

  it("独立文件缺失密钥时拒绝解析，不从同目录 .env 补读", () => {
    const result = resolveConfig("missing-secret.env");
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DEMO_SESSION_SECRET");
  });

  it("候选镜像覆盖只保留本机验收端口，并共用同一个镜像", () => {
    const result = resolveConfig("demo.env", true);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const compose = JSON.parse(result.stdout);
    expect(compose.services.app.image).toBe("zhiliao-demo-verify:story-2-2");
    expect(compose.services.mockllm.image).toBe(compose.services.app.image);
    expect(path.resolve(compose.services.app.build.context)).toBe(path.resolve(fixtureDir));
    expect(compose.services.ingress.ports).toHaveLength(1);
    expect(compose.services.ingress.ports[0]).toMatchObject({ host_ip: "127.0.0.1", target: 8080, published: "3322" });
    expect(compose.services.app.ports).toBeUndefined();
    expect(compose.services.mockllm.ports).toBeUndefined();
  });

  it("对照场景证明省略 --env-file 确实会读取同目录 .env", () => {
    const result = resolveConfig();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const compose = JSON.parse(result.stdout);
    expect(compose.services.app.environment.SESSION_SECRET).toBe("production-fixture-secret-0123456789");
  });

  it("验收端口及运行标识由独立环境文件同时应用到所有临时资源", () => {
    const result = resolveConfig("custom-port.env", true);
    expect(result.status, result.stderr).toBe(0);
    const compose = JSON.parse(result.stdout);
    expect(compose.services.ingress.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", target: 8080, published: "3376" }),
    ]);
    for (const item of [
      compose.services.app, compose.services.mockllm, compose.services.ingress,
      compose.networks.demo_net, compose.networks.ingress_net,
      compose.volumes.demo_db, compose.volumes.demo_uploads, compose.volumes.demo_notes,
    ]) {
      expect(item.labels["io.zhiliao.demo-verify.run"]).toBe("fixture-run-123");
    }
    expect(result.stdout).not.toContain("production-fixture");
  });
});
