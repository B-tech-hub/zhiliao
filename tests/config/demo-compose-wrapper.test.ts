import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoComposeArgs, runDemoCompose } from "../../scripts/demo-compose.mjs";
import { cleanDockerEnvironment } from "../../scripts/demo-verification-utils.mjs";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Docker Demo 包装启动器", () => {
  it("默认补齐独立环境文件、project 和 compose 文件", () => {
    expect(buildDemoComposeArgs(["up", "-d"])).toEqual([
      "--env-file", "demo.env", "-p", "zhiliao-demo", "-f", "docker-compose.demo.yml", "up", "-d",
    ]);
  });

  it("清理宿主 DEMO_/COMPOSE_ 后再调用 docker compose", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhiliao-demo-compose-wrapper-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "demo.env"), "DEMO_SESSION_SECRET=from-file-secret-0123456789\n");
    vi.stubEnv("DEMO_SESSION_SECRET", "host-secret-should-not-leak");
    vi.stubEnv("DEMO_PASSWORD", "host-password");
    vi.stubEnv("COMPOSE_PROJECT_NAME", "production");
    const spawnFn = vi.fn(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    const code = await runDemoCompose(["up", "-d"], { spawnFn, cwd: dir, env: cleanDockerEnvironment() });
    expect(code).toBe(0);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnFn.mock.calls[0];
    expect(command).toBe("docker");
    expect(args).toEqual(["compose", "--env-file", "demo.env", "-p", "zhiliao-demo", "-f", "docker-compose.demo.yml", "up", "-d"]);
    expect(options.env.DEMO_SESSION_SECRET).toBeUndefined();
    expect(options.env.DEMO_PASSWORD).toBeUndefined();
    expect(options.env.COMPOSE_PROJECT_NAME).toBeUndefined();
    expect(process.env.DEMO_SESSION_SECRET).toBe("host-secret-should-not-leak");
  });
});
