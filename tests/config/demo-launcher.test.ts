import type { SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class DemoChild extends EventEmitter {
  killed = false;
  kill = vi.fn(() => {
    this.killed = true;
    return true;
  });
}

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn<(command: string, args: string[], options: SpawnOptions) => DemoChild>(),
}));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const root = path.resolve(import.meta.dirname, "../..");
const hostEnv = {
  DEMO_MODE: "0",
  DEMO_RUNTIME: "https://host.invalid/v1",
  DEMO_LLM_BASE_URL: "https://override.invalid/v1",
  APP_PASSWORD: "host-password",
  SESSION_SECRET: "host-session-secret",
  DATABASE_PATH: "./host-data/db/app.db",
  UPLOAD_DIR: "./host-data/uploads",
  NOTES_EXPORT_DIR: "./host-data/notes",
  LLM_BASE_URL: "https://host.invalid/v1",
  LLM_API_KEY: "host-key",
  LLM_MODEL: "host-model",
  PORT: "4318",
};
const expectedEnv = {
  DEMO_MODE: "1",
  DEMO_RUNTIME: "local",
  APP_PASSWORD: "demo",
  SESSION_SECRET: "zhiliao-demo-session-secret-0123",
  DATABASE_PATH: "./data-demo/db/app.db",
  UPLOAD_DIR: "./data-demo/uploads",
  NOTES_EXPORT_DIR: "./data-demo/notes",
  LLM_BASE_URL: "http://127.0.0.1:8787/v1",
  LLM_API_KEY: "demo",
  LLM_MODEL: "mock",
  PORT: "4318",
};
const fetchMock = vi.fn<typeof fetch>();
const probeResponse = () => new Response(JSON.stringify({ choices: [{ message: { content: "__zhiliao_mock_pong__" } }] }));

beforeEach(() => {
  vi.resetModules();
  spawnMock.mockReset().mockImplementation(() => new DemoChild());
  fetchMock.mockReset().mockImplementation(async () => probeResponse());
  for (const [key, value] of Object.entries(hostEnv)) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", fetchMock);
  // 执行真实启动脚本，但拦截子进程、退出、信号注册及探测，不启动服务或读取环境文件。
  vi.spyOn(process, "on").mockReturnValue(process);
  vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`demo exit ${code}`); });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function assertNextCall(index: number) {
  const [command, args, options] = spawnMock.mock.calls[index];
  expect(command).toBe(process.execPath);
  expect(args).toEqual([path.join(root, "node_modules/next/dist/bin/next"), "dev", "--turbopack"]);
  expect(options.cwd).toBe(root);
  expect(options.stdio).toBe("inherit");
  // 只比较本测试的键，失败输出也不会带出宿主机的其他凭据。
  expect(Object.fromEntries(Object.keys(expectedEnv).map((key) => [key, options.env?.[key]]))).toEqual(expectedEnv);
  expect(Object.fromEntries(Object.keys(hostEnv).map((key) => [key, process.env[key]]))).toEqual(hostEnv);
}

function assertProbeCall(index: number) {
  const [url, options] = fetchMock.mock.calls[index];
  expect(url).toBe("http://127.0.0.1:8787/v1/chat/completions");
  expect(options?.method).toBe("POST");
  expect(new Headers(options?.headers).get("content-type")).toBe("application/json");
  expect(JSON.parse(String(options?.body))).toEqual({
    messages: [{ role: "user", content: "__zhiliao_mock_probe__" }],
  });
}

describe("源码 Demo 启动器", () => {
  it("已有 mock 时复用，向 Next 传入本机标记并覆盖宿主数据与凭据", async () => {
    await import("../../scripts/demo.mjs");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    assertNextCall(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    assertProbeCall(0);
    expect(console.log).toHaveBeenCalledWith("  密码：demo");
  });

  it("探测失败时先启动固定 mock，再将本机配置传入 Next", async () => {
    fetchMock.mockRejectedValueOnce(new Error("mock 尚未启动"));
    await import("../../scripts/demo.mjs");

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual([path.join(root, "scripts/mock-llm.mjs")]);
    expect(options).toEqual({ cwd: root, stdio: "inherit" });
    assertNextCall(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    assertProbeCall(0);
    assertProbeCall(1);
  });

  it.each([
    ["错误 pong", JSON.stringify({ choices: [{ message: { content: "another-service" } }] })],
    ["缺少 pong", JSON.stringify({ choices: [{ message: {} }] })],
    ["畸形 JSON", "not-json"],
  ])("HTTP 200 但%s时不复用该服务", async (_label, body) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    await import("../../scripts/demo.mjs");

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0][1]).toEqual([path.join(root, "scripts/mock-llm.mjs")]);
    assertNextCall(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    assertProbeCall(0);
    assertProbeCall(1);
    expect(console.log).not.toHaveBeenCalledWith("[demo] 检测到 8787 端口已有 mock LLM 在运行，直接复用");
  });

  it("mock 就绪超时仍报错、清理并退出，不启动 Next", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response("{}", { status: 503 }));
    const launch = import("../../scripts/demo.mjs");
    const failed = expect(launch).rejects.toThrow("demo exit 1");
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    await vi.runAllTimersAsync();
    await failed;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.results[0].value.kill).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[demo] mock LLM 启动超时，请检查 8787 端口占用情况");
  });

  it("mock 异常退出保留错误码并终止本轮子进程", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await import("../../scripts/demo.mjs");

    expect(() => spawnMock.mock.results[0].value.emit("exit", 7)).toThrow("demo exit 7");
    expect(console.error).toHaveBeenCalledWith("[demo] mock LLM 进程意外退出（code=7），8787 端口可能被其他程序占用");
    for (const result of spawnMock.mock.results) expect(result.value.kill).toHaveBeenCalledTimes(1);
  });

  it("复用 mock 时应用退出只清理本轮启动的 Next", async () => {
    await import("../../scripts/demo.mjs");

    expect(() => spawnMock.mock.results[0].value.emit("exit", 0)).toThrow("demo exit 0");
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.results[0].value.kill).toHaveBeenCalledTimes(1);
  });
});
