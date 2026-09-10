import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { demoForbiddenResponse, isDemoMode } from "@/lib/demo-guard";

describe("Demo 服务端能力边界", () => {
  beforeEach(() => {
    delete process.env.DEMO_MODE;
  });

  it("仅在 DEMO_MODE=1 时启用", () => {
    expect(isDemoMode()).toBe(false);
    process.env.DEMO_MODE = "1";
    expect(isDemoMode()).toBe(true);
  });

  it("统一返回 403 且不依赖请求内容", async () => {
    const response = demoForbiddenResponse();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "体验模式不支持此操作" });
  });

  it("设置 LLM、Token 和导出入口在 Demo 中直接拒绝", async () => {
    process.env.DEMO_MODE = "1";
    const [{ PATCH }, { GET: getTokens }, { GET: exportData }] = await Promise.all([
      import("@/app/api/settings/llm/route"),
      import("@/app/api/settings/tokens/route"),
      import("@/app/api/export/route"),
    ]);

    expect((await PATCH(new NextRequest("http://x/api/settings/llm", { method: "PATCH", body: "{}" }))).status).toBe(403);
    expect((await getTokens()).status).toBe(403);
    expect((await exportData()).status).toBe(403);
  }, 15_000);
});
