// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideNav } from "@/components/nav";
import { COMMAND_EVENTS } from "@/components/command-events";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("SideNav 折叠状态契约", () => {
  afterEach(() => cleanup());
  it("响应命令事件切换 data-collapsed", () => {
    const { container } = render(<SideNav topics={[]} inboxCount={0} />);
    const nav = container.querySelector("aside");
    expect(nav?.getAttribute("data-collapsed")).toBe("false");
    fireEvent(window, new Event(COMMAND_EVENTS.toggleNav));
    expect(nav?.getAttribute("data-collapsed")).toBe("true");
  });
});
