import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { version } from "../../package.json";

// 握手不访问知识数据；本组仅验证版本和协议外壳，不代替鉴权与工具语义验收。
vi.mock("@/app/api/external/knowledge/route", () => ({ GET: vi.fn() }));

function initialize(id: string | number | null) {
  return new NextRequest("http://localhost/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer mcp-version-test" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "initialize" }),
  });
}

describe("MCP 握手版本", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([1, "version-check", null])("返回包版本并保留请求 id %s 与协议元数据", async (id) => {
    const { POST } = await import("@/app/api/mcp/route");
    const response = await POST(initialize(id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "zhiliao", version },
        capabilities: { tools: {} },
      },
    });
  });

  it("加载时不接受环境变量改写应用版本", async () => {
    vi.stubEnv("npm_package_version", "99.0.0");
    vi.stubEnv("APP_VERSION", "98.0.0");
    const { POST } = await import("@/app/api/mcp/route");
    const response = await POST(initialize("environment"));
    expect((await response.json()).result.serverInfo.version).toBe(version);
  });
});
