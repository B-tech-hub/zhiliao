// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/app/(app)/settings/settings-panel";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, className }: PropsWithChildren<{ href: string; className?: string }>) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));

const NOW = "2026-09-15T02:24:39Z";
const BACKUP_AT = Date.parse("2026-09-15T02:22:55Z");

function settingsProps(lastBackupAt: number | null): ComponentProps<typeof SettingsPanel> {
  const optionalModel = {
    model: "", baseUrl: "", apiKeyMasked: "未配置",
    sources: { baseUrl: "none", apiKey: "none", model: "none" } as const,
    shadowed: { baseUrl: null, model: null, apiKey: false },
  };
  return {
    topics: [{ id: "inbox", name: "未分类", isSystem: 1, noteCount: 0 }],
    llm: {
      configured: true, baseUrl: "http://127.0.0.1:9/v1", model: "test-model",
      apiKeyMasked: "test…1234", hasDbConfig: true,
      sources: { baseUrl: "db", apiKey: "db", model: "db" },
      shadowed: { baseUrl: null, model: null, apiKey: false },
    },
    vision: optionalModel, image: optionalModel, reasoning: optionalModel, embedding: optionalModel,
    apiTokens: [], correctionLearning: { enabled: false, count: 0 },
    features: { handwriting: false, imageGen: false, mermaid: false, reasoning: false },
    queue: { pending: 0, running: 0, failed: 0, recentFailures: [] },
    review: { enabled: false, lastWeek: null }, lastBackupAt, trashCount: 0,
  };
}

let hydrationRoot: Root | undefined;
let hydrationContainer: HTMLDivElement | undefined;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  // 只固定 Date，保留 React 调度与异步请求所需的真实计时器。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.stubEnv("TZ", "Asia/Shanghai");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockRejectedValue(new Error("未模拟的请求"));
  refresh.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  try {
    if (hydrationRoot) await act(async () => hydrationRoot?.unmount());
    cleanup();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  } finally {
    hydrationRoot = undefined;
    hydrationContainer?.remove();
    hydrationContainer = undefined;
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

async function hydrateSettings({
  lastBackupAt, clientTimezone = "Asia/Shanghai", serverNow = NOW, clientNow = serverNow,
}: {
  lastBackupAt: number | null;
  clientTimezone?: string;
  serverNow?: string;
  clientNow?: string;
}) {
  const props = settingsProps(lastBackupAt);
  vi.stubEnv("TZ", "UTC");
  vi.setSystemTime(new Date(serverNow));
  hydrationContainer = document.createElement("div");
  hydrationContainer.innerHTML = renderToString(<SettingsPanel {...props} />);
  document.body.append(hydrationContainer);
  const serverText = within(hydrationContainer).getByText(/^最近备份：/).textContent;
  // 时间尚未本地化时，设置内容和备份操作也必须保留在服务端页面中。
  expect(within(hydrationContainer).getByRole("heading", { name: "设置" })).toBeTruthy();
  expect(within(hydrationContainer).getByRole("button", { name: "立即备份" })).toBeTruthy();

  vi.stubEnv("TZ", clientTimezone);
  vi.setSystemTime(new Date(clientNow));
  const errors: string[] = [];
  await act(async () => {
    hydrationRoot = hydrateRoot(hydrationContainer!, <SettingsPanel {...props} />, {
      onRecoverableError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    });
  });
  return { serverText, errors, props };
}

describe("设置页备份时间水合", () => {
  it.each([
    { name: "跨时区", lastBackupAt: BACKUP_AT, expected: "10:22" },
    { name: "同一时区", lastBackupAt: BACKUP_AT, clientTimezone: "UTC", expected: "02:22" },
    {
      name: "同一时区跨午夜", lastBackupAt: Date.parse("2026-09-14T23:59:00Z"), clientTimezone: "UTC",
      serverNow: "2026-09-14T23:59:59Z", clientNow: "2026-09-15T00:00:01Z", expected: "9月14日",
    },
    {
      name: "同一时区跨年", lastBackupAt: Date.parse("2026-12-15T12:00:00Z"), clientTimezone: "UTC",
      serverNow: "2026-12-31T23:59:59Z", clientNow: "2027-01-01T00:00:01Z", expected: "2026/12/15",
    },
    { name: "时间戳为零", lastBackupAt: 0, expected: "1970/01/01" },
    { name: "无备份", lastBackupAt: null, expected: "从未备份" },
  ])("$name：首帧一致，挂载后显示正确时间", async (scenario) => {
    const { serverText, errors } = await hydrateSettings(scenario);
    expect(errors).toEqual([]);
    expect(serverText).toBe(`最近备份：${scenario.lastBackupAt === null ? "从未备份" : "—"}`);
    expect(screen.getByText(/^最近备份：/).textContent).toBe(`最近备份：${scenario.expected}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { name: "首次备份", lastBackupAt: null },
    { name: "更新已有备份", lastBackupAt: BACKUP_AT },
  ])("$name：请求期间保留原值，成功后更新时间", async ({ lastBackupAt }) => {
    render(<SettingsPanel {...settingsProps(lastBackupAt)} />);
    const oldText = screen.getByText(/^最近备份：/).textContent;
    let finishBackup!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { finishBackup = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "立即备份" }));
    expect(screen.getByRole("button", { name: "备份中…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/^最近备份：/).textContent).toBe(oldText);
    await act(async () => {
      finishBackup(Response.json({ backedUpAt: Date.parse("2026-09-15T03:05:00Z") }));
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/backup", { method: "POST" });
    expect(screen.getByText("最近备份：11:05")).toBeTruthy();
    expect(screen.getByText("✓ 已备份")).toBeTruthy();
    expect(screen.getByRole("button", { name: "立即备份" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("link", { name: "导出全部数据" }).getAttribute("href")).toBe("/api/export");
  });

  it.each([
    { lastBackupAt: null, failure: "http" },
    { lastBackupAt: BACKUP_AT, failure: "http" },
    { lastBackupAt: null, failure: "network" },
    { lastBackupAt: BACKUP_AT, failure: "network" },
  ])("备份失败保留原值：$failure / $lastBackupAt", async ({ lastBackupAt, failure }) => {
    render(<SettingsPanel {...settingsProps(lastBackupAt)} />);
    const oldText = screen.getByText(/^最近备份：/).textContent;
    if (failure === "http") {
      fetchMock.mockResolvedValueOnce(Response.json({ error: "备份失败" }, { status: 500 }));
    } else {
      fetchMock.mockRejectedValueOnce(new TypeError("连接中断"));
    }
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "立即备份" })); });
    expect(screen.getByText(/^最近备份：/).textContent).toBe(oldText);
    expect(screen.getByText(failure === "http" ? "✕ 备份失败" : "✕ 网络错误")).toBeTruthy();
    expect(screen.queryByText("✓ 已备份")).toBeNull();
    expect(screen.getByRole("button", { name: "立即备份" }).hasAttribute("disabled")).toBe(false);
  });

  it("水合后仍可保存文本模型配置，清空输入密钥并请求刷新", async () => {
    const { errors, props } = await hydrateSettings({ lastBackupAt: BACKUP_AT });
    expect(errors).toEqual([]);
    const keyInput = hydrationContainer?.querySelector<HTMLInputElement>('input[type="password"]');
    if (!keyInput) throw new Error("缺少文本模型密钥输入框");
    expect(keyInput.placeholder).toContain(props.llm.apiKeyMasked);
    fireEvent.change(screen.getByDisplayValue("test-model"), { target: { value: "updated-model" } });
    fireEvent.change(keyInput, { target: { value: "test-only-new-key" } });
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "保存", exact: true })[0]); });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/settings/llm", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "updated-model", apiKey: "test-only-new-key" }),
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(keyInput.value).toBe("");
    expect(keyInput.placeholder).toContain(props.llm.apiKeyMasked);
    expect(screen.getByText("✓ 已保存，立即生效")).toBeTruthy();
    expect(screen.getByText("最近备份：10:22")).toBeTruthy();
  });
});
