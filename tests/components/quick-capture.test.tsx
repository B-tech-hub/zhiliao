// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickCapture } from "@/components/quick-capture";
import { COMMAND_EVENTS } from "@/components/command-events";

// 只挑 <a> 认得的属性；prefetch 透传给 DOM 会招来 React 警告
vi.mock("next/link", () => ({
  default: ({ children, href, className, "aria-label": ariaLabel }: React.PropsWithChildren<{ href: string; className?: string; "aria-label"?: string }>) => (
    <a href={href} className={className} aria-label={ariaLabel}>{children}</a>
  ),
}));

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push: vi.fn() }) }));

const TOPICS = [
  { id: "inbox", name: "收件箱", isSystem: 1 },
  { id: "topic-1", name: "项目", isSystem: 0 },
];

const openOverlay = () => fireEvent.click(screen.getByRole("button", { name: "快速记录" }));
const body = () => screen.getByRole("textbox", { name: "笔记正文" }) as HTMLTextAreaElement;

describe("QuickCapture", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
  });

  /* 焦点没进正文时，用户以为在记笔记，敲下的字其实落进了底层页面。
     命令面板曾经真这么坏过，这条是这个浮层最要紧的契约。 */
  it("打开后焦点立即落在正文", async () => {
    render(<QuickCapture topics={TOPICS} />);
    openOverlay();
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(body());
  });

  /* Esc 只该收起最上面那一层。监听器若挂在 window 上，
     助手面板也开着时一次 Esc 会把两层一起关掉。 */
  it("Esc 关闭浮层且事件不外泄到 window", async () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<QuickCapture topics={TOPICS} />);
    openOverlay();
    await screen.findByRole("dialog");
    fireEvent.keyDown(body(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
  });

  // 焦点被 Tab 出浮层后 Esc 仍要管用——监听器挂在浮层节点上时这里会失灵
  it("焦点不在浮层内时 Esc 依然能关", async () => {
    render(<QuickCapture topics={TOPICS} />);
    openOverlay();
    await screen.findByRole("dialog");
    body().blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  /* 命令面板可以叠在浮层之上。两者的监听都在 window 捕获阶段，
     stopPropagation 分不出先后（它只挡后续节点），只能显式让路。 */
  it("上面压着别的浮层时，Esc 不归自己消费", async () => {
    render(<QuickCapture topics={TOPICS} />);
    openOverlay();
    await screen.findByRole("dialog");
    // 模拟命令面板叠在上层
    const upper = document.createElement("div");
    upper.setAttribute("role", "dialog");
    document.body.appendChild(upper);
    fireEvent.keyDown(body(), { key: "Escape" });
    await waitFor(() => expect(screen.queryAllByRole("dialog").length).toBe(2));
    upper.remove();
    // 上层撤走后，Esc 重新归自己
    fireEvent.keyDown(body(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("关闭后重新打开，草稿还在", async () => {
    render(<QuickCapture topics={TOPICS} />);
    openOverlay();
    await screen.findByRole("dialog");
    fireEvent.change(body(), { target: { value: "半句话" } });
    fireEvent.keyDown(body(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    openOverlay();
    await screen.findByRole("dialog");
    expect(body().value).toBe("半句话");
  });

  /* 全屏遮罩不可点，就成了没有出口的陷阱——用户会以为页面卡死。
     草稿留在组件里，关掉再开原样还在，这一下什么都不会丢。 */
  it("点遮罩关闭浮层，草稿不丢", async () => {
    const { container } = render(<QuickCapture topics={TOPICS} />);
    openOverlay();
    await screen.findByRole("dialog");
    fireEvent.change(body(), { target: { value: "还没写完" } });
    const scrim = container.querySelector(".fixed.inset-0") as HTMLElement;
    fireEvent.mouseDown(scrim);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    openOverlay();
    await screen.findByRole("dialog");
    expect(body().value).toBe("还没写完");
  });

  /* 曾经用 preventDefault 把焦点摁在正文里，结果浮层内部所有元素的 mousedown
     默认行为一并被吞：主题下拉打不开、点正文挪不动光标、拖不出选区。
     遮罩的关闭动作必须由浮层 stopPropagation 挡住，不能靠 preventDefault。 */
  it("浮层内部的 mousedown 默认行为不被吞掉", async () => {
    render(<QuickCapture topics={TOPICS} />);
    openOverlay();
    await screen.findByRole("dialog");
    for (const el of [body(), screen.getByRole("combobox", { name: "归入主题" })]) {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    // 而且不该顺手把浮层关掉
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  /* 浮层是「就地捕获」：保存后原地刷新列表，不把用户从当前页面弹走。 */
  it("保存成功后刷新列表、不跳转，并收起浮层清掉草稿", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "note-1" }) }));
    render(<QuickCapture topics={TOPICS} />);
    openOverlay();
    await screen.findByRole("dialog");
    fireEvent.change(body(), { target: { value: "记一条" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "已保存" })).toBeTruthy());
    expect(refresh).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 2000 });
    openOverlay();
    expect(body().value).toBe("");
  });

  it("命令面板的新建动作能唤起同一个浮层", async () => {
    render(<QuickCapture topics={TOPICS} />);
    fireEvent(window, new Event(COMMAND_EVENTS.quickCapture));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  // 小屏不走浮层：整页形态在软键盘弹起时更好用
  it("移动端入口仍是指向 /notes/new 的整页链接", () => {
    render(<QuickCapture topics={TOPICS} />);
    expect(screen.getByRole("link", { name: "快速记录" }).getAttribute("href")).toBe("/notes/new");
  });

  // 系统主题不在下拉里，预选它会让选择框显示空白
  it("下拉不含系统主题", async () => {
    render(<QuickCapture topics={TOPICS} />);
    openOverlay();
    await screen.findByRole("dialog");
    const select = screen.getByRole("combobox", { name: "归入主题" });
    expect(select.textContent).toContain("项目");
    expect(select.textContent).not.toContain("收件箱");
  });
});
