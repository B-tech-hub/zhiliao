// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideNav } from "@/components/nav";
import { COMMAND_EVENTS } from "@/components/command-events";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// 折叠态的事实来源是 <html> 上的属性，跨用例必须清干净，否则用例之间会串味
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.navCollapsed;
  window.localStorage.clear();
});

describe("SideNav 折叠状态契约", () => {
  it("响应命令事件切换 data-collapsed", () => {
    const { container } = render(<SideNav topics={[]} inboxCount={0} />);
    const nav = container.querySelector("aside");
    expect(nav?.getAttribute("data-collapsed")).toBe("false");
    fireEvent(window, new Event(COMMAND_EVENTS.toggleNav));
    expect(nav?.getAttribute("data-collapsed")).toBe("true");
  });

  it("折叠时把偏好写到 <html> 与 localStorage", () => {
    render(<SideNav topics={[]} inboxCount={0} />);
    fireEvent(window, new Event(COMMAND_EVENTS.toggleNav));
    expect(document.documentElement.dataset.navCollapsed).toBe("1");
    expect(window.localStorage.getItem("zhiliao.navCollapsed")).toBe("1");

    fireEvent(window, new Event(COMMAND_EVENTS.toggleNav));
    expect(document.documentElement.dataset.navCollapsed).toBe("0");
    expect(window.localStorage.getItem("zhiliao.navCollapsed")).toBe("0");
  });

  it("首屏沿用阻塞脚本写下的折叠态，而不是重新展开", () => {
    document.documentElement.dataset.navCollapsed = "1";
    const { container } = render(<SideNav topics={[]} inboxCount={0} />);
    expect(container.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true");
    // 已折叠时再收一次应当是展开，不能因为 state 初值是 false 而反向折叠
    fireEvent(window, new Event(COMMAND_EVENTS.toggleNav));
    expect(document.documentElement.dataset.navCollapsed).toBe("0");
  });

  it("开关按钮与快捷键共用同一条命令事件", () => {
    const { container } = render(<SideNav topics={[]} inboxCount={0} />);
    const toggle = screen.getByRole("button", { name: "收起" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(container.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("展开");
  });

  it("折叠态不靠条件渲染，导航项文字仍在无障碍树里", () => {
    document.documentElement.dataset.navCollapsed = "1";
    render(<SideNav topics={[]} inboxCount={0} />);
    // jsdom 不跑 Tailwind，这里验的是"没有把 label 写成 {!collapsed && ...}"——
    // 一旦改成条件渲染，折叠后只剩图标的链接在真实浏览器里就没有可读名称了
    expect(screen.getByRole("link", { name: "未分类" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "设置" })).toBeTruthy();
  });
});
