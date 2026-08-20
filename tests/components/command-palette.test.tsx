// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/command-palette";

const push = vi.fn();
let theme = "light";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: theme, setTheme: (value: string) => { theme = value; } }),
}));

describe("CommandPalette", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    push.mockReset();
    theme = "light";
  });

  it("通过命令键打开并执行主题跳转", async () => {
    render(<CommandPalette topics={[{ id: "topic-1", name: "项目" }]} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /项目/ }));
    expect(push).toHaveBeenCalledWith("/topics/topic-1");
  });

  it("输入搜索词后展示 API 笔记并可回车打开", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ id: "note-1", title: "测试笔记", excerpt: "正文", topicName: "项目" }] }),
    }));
    render(<CommandPalette topics={[]} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("textbox", { name: "搜索命令" });
    fireEvent.change(input, { target: { value: "测试" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /测试笔记/ })).toBeTruthy(), { timeout: 1000 });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/notes/note-1");
  });

  /* 先发的请求可能后回来。没有 abort 时它会把新词的结果盖掉，
     用户看到的是上一个词搜出来的东西。 */
  it("改词后旧请求被中断，不覆盖新结果", async () => {
    const aborted: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      const q = decodeURIComponent(/q=([^&]*)/.exec(String(url))?.[1] ?? "");
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted.push(q);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
        // 旧词慢、新词快，制造“先发后回”
        setTimeout(() => resolve({
          ok: true,
          json: async () => ({ results: [{ id: q, title: `结果:${q}`, excerpt: "", topicName: "" }] }),
        }), q === "旧" ? 500 : 0);
      });
    }));
    render(<CommandPalette topics={[]} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByRole("textbox", { name: "搜索命令" });
    fireEvent.change(input, { target: { value: "旧" } });
    // 必须等过 300ms 防抖，让“旧”的请求真正上路，否则 cleanup 时无请求可中断
    await new Promise((r) => setTimeout(r, 350));
    fireEvent.change(input, { target: { value: "新" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /结果:新/ })).toBeTruthy(), { timeout: 1500 });
    // 等过旧请求本该返回的时刻，确认它没有把结果盖回去
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByRole("button", { name: /结果:旧/ })).toBeNull();
    expect(aborted).toContain("旧");
  });

  it("Escape 关闭面板", async () => {
    render(<CommandPalette topics={[]} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  /* 面板一打开就必须抢到焦点。焦点留在外面时，用户以为在搜索，
     敲下的字其实落进了笔记正文——曾经真这么坏过。 */
  it("打开后输入框立即获得焦点", async () => {
    render(<CommandPalette topics={[]} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByRole("textbox", { name: "搜索命令" });
    expect(document.activeElement).toBe(input);
  });

  it("关闭后焦点还给打开前的元素", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    render(<CommandPalette topics={[]} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
