// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiTokenSection } from "@/app/(app)/settings/api-token-section";

vi.mock("next/link", () => ({
  default: ({ children, href, className }: React.PropsWithChildren<{ href: string; className?: string }>) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

const TOKEN_INFO = {
  id: "token-1",
  scope: "capture:write",
  prefix: "zhl_abcd",
  last4: "1234",
  createdAt: 1,
  lastUsedAt: null,
};

describe("ApiTokenSection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("创建手机快捷记录 Token 后显示配置与自测入口", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "zhl_secret", tokenInfo: TOKEN_INFO }),
    } as Response);

    render(<ApiTokenSection initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));

    expect(await screen.findByText("zhl_secret")).toBeTruthy();
    expect(screen.getByDisplayValue(`${window.location.origin}/api/external/capture`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "写入知识库" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/明文关闭页面后无法找回/)).toBeTruthy();
  });

  it("复制请求信息时包含地址、Bearer Token 与 JSON 请求体", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "zhl_secret", tokenInfo: TOKEN_INFO }),
    } as Response);

    render(<ApiTokenSection initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));
    await screen.findByText("zhl_secret");
    fireEvent.click(screen.getByRole("button", { name: "复制请求信息" }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(`${window.location.origin}/api/external/capture`)));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Authorization: Bearer zhl_secret"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('{"content":"快捷指令输入"}'));
  });

  it("自测成功后清空输入并提供笔记链接", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "zhl_secret", tokenInfo: TOKEN_INFO }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "note-1" }) } as Response);

    render(<ApiTokenSection initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));
    await screen.findByText("zhl_secret");
    const input = screen.getByRole("textbox", { name: "写入一条真实笔记" });
    fireEvent.change(input, { target: { value: "手机捕获验收" } });
    fireEvent.click(screen.getByRole("button", { name: "写入知识库" }));

    expect(await screen.findByText("写入成功，笔记已进入 AI 整理队列。")).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("link", { name: "打开这条笔记" }).getAttribute("href")).toBe("/notes/note-1");
    expect(fetch).toHaveBeenLastCalledWith("/api/external/capture", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer zhl_secret" }),
      body: JSON.stringify({ content: "手机捕获验收" }),
    }));
  });

  it("401 时保留输入并提示重建 Token", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "zhl_secret", tokenInfo: TOKEN_INFO }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "无效或无权限的 Token" }) } as Response);

    render(<ApiTokenSection initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));
    await screen.findByText("zhl_secret");
    const input = screen.getByRole("textbox", { name: "写入一条真实笔记" });
    fireEvent.change(input, { target: { value: "失败后不能丢" } });
    fireEvent.click(screen.getByRole("button", { name: "写入知识库" }));

    expect(await screen.findByText(/Token 无效或已吊销/)).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe("失败后不能丢");
  });

  it("网络失败时保留输入", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "zhl_secret", tokenInfo: TOKEN_INFO }) } as Response)
      .mockRejectedValueOnce(new Error("offline"));

    render(<ApiTokenSection initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));
    await screen.findByText("zhl_secret");
    const input = screen.getByRole("textbox", { name: "写入一条真实笔记" });
    fireEvent.change(input, { target: { value: "断网草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "写入知识库" }));

    expect(await screen.findByText(/内容仍保留在输入框/)).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe("断网草稿");
  });

  it("吊销后从现有 Token 列表移除", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    render(<ApiTokenSection initial={[TOKEN_INFO]} />);

    fireEvent.click(screen.getByRole("button", { name: "吊销" }));
    expect(await screen.findByText(/使用它的手机快捷指令会立即失效/)).toBeTruthy();
    expect(screen.queryByText(/zhl_abcd/)).toBeNull();
  });

  it("吊销刚创建的 Token 后收起明文和手机自测区", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "zhl_secret", tokenInfo: TOKEN_INFO }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);

    render(<ApiTokenSection initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));
    await screen.findByText("zhl_secret");
    fireEvent.click(screen.getByRole("button", { name: "吊销" }));

    expect(await screen.findByText(/使用它的手机快捷指令会立即失效/)).toBeTruthy();
    expect(screen.queryByText("zhl_secret")).toBeNull();
    expect(screen.queryByText("手机快捷记录", { selector: "h3" })).toBeNull();
  });

  it("吊销刚创建的 Token 时保留未提交草稿", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "zhl_secret", tokenInfo: TOKEN_INFO }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "zhl_secret_2", tokenInfo: { ...TOKEN_INFO, id: "token-2" } }) } as Response);

    render(<ApiTokenSection initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));
    await screen.findByText("zhl_secret");
    const input = screen.getByRole("textbox", { name: "写入一条真实笔记" });
    fireEvent.change(input, { target: { value: "吊销后仍要保留" } });
    fireEvent.click(screen.getByRole("button", { name: "吊销" }));
    expect(await screen.findByText(/草稿已保留/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));
    const restored = await screen.findByRole("textbox", { name: "写入一条真实笔记" });
    expect((restored as HTMLTextAreaElement).value).toBe("吊销后仍要保留");
  });

  it("复制降级失败时显示可手动选择的文本", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "zhl_secret", tokenInfo: TOKEN_INFO }),
    } as Response);

    render(<ApiTokenSection initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));
    await screen.findByText("zhl_secret");
    fireEvent.click(screen.getByRole("button", { name: "复制请求信息" }));

    expect(await screen.findByLabelText("复制失败，请手动选中文本")).toBeTruthy();
    expect(document.body.querySelectorAll('textarea[style*="position: fixed"]')).toHaveLength(0);
  });

  it("复制失败后吊销 Token 会清除降级区中的明文", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "zhl_secret", tokenInfo: TOKEN_INFO }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);

    render(<ApiTokenSection initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));
    await screen.findByText("zhl_secret");
    fireEvent.click(screen.getByRole("button", { name: "复制请求信息" }));
    expect(await screen.findByLabelText("复制失败，请手动选中文本")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "吊销" }));
    await screen.findByText(/草稿已保留/);
    expect(screen.queryByLabelText("复制失败，请手动选中文本")).toBeNull();
    expect(screen.queryByDisplayValue(/zhl_secret/)).toBeNull();
  });
});
