import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

// ESM 下模块命名空间不可配置，无法用 vi.spyOn 打桩内置模块的具名导出；改用 vi.mock 工厂替换 spawn
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

import { attachVerificationSignals, killProcessTree } from "../../scripts/demo-verification-utils.mjs";

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe("Demo 验收进程辅助", () => {
  it("Windows 用 taskkill 终止进程树", () => {
    spawnMock.mockReturnValue(new EventEmitter() as never);
    const previous = process.platform;
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
    try {
      killProcessTree({ pid: 4242 });
      expect(spawnMock).toHaveBeenCalledWith("taskkill", ["/pid", "4242", "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } finally {
      Object.defineProperty(process, "platform", { configurable: true, value: previous });
    }
  });

  it("信号处理只触发一次并可以卸载", () => {
    const originalOn = process.on.bind(process);
    const originalOff = process.off.bind(process);
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = { SIGINT: [], SIGTERM: [] };
    const onSpy = vi.spyOn(process, "on").mockImplementation((event, listener) => {
      const name = String(event);
      if (name === "SIGINT" || name === "SIGTERM") {
        listeners[name].push(listener as (...args: unknown[]) => void);
        return process;
      }
      return originalOn(event, listener as never);
    });
    const offSpy = vi.spyOn(process, "off").mockImplementation((event, listener) => {
      const name = String(event);
      if (name === "SIGINT" || name === "SIGTERM") {
        listeners[name] = listeners[name].filter((item) => item !== listener);
        return process;
      }
      return originalOff(event, listener as never);
    });
    try {
      const onAbort = vi.fn();
      const detach = attachVerificationSignals(onAbort);
      listeners.SIGINT[0]("SIGINT");
      listeners.SIGINT[0]("SIGINT");
      expect(onAbort).toHaveBeenCalledTimes(1);
      detach();
      for (const handler of listeners.SIGTERM) handler("SIGTERM");
      expect(onAbort).toHaveBeenCalledTimes(1);
    } finally {
      onSpy.mockRestore();
      offSpy.mockRestore();
    }
  });
});
