import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getDb, getSqlite } from "@/db";
import { notes } from "@/db/schema";
import { POST } from "@/app/api/external/capture/route";
import { createApiToken, revokeApiToken } from "@/lib/api-token";
import { wipeData } from "../helpers/db";

function post(token: string | null, body: unknown) {
  return POST(new NextRequest("http://x/api/external/capture", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/external/capture", () => {
  beforeEach(() => {
    wipeData();
    getSqlite().exec("DELETE FROM api_tokens;");
  });

  it("capture:write Token 可以创建笔记并进入待整理状态", async () => {
    const created = createApiToken("capture:write");
    const response = await post(created.token, { content: "手机捕获接口验收" });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.topicId).toBe("inbox");
    const note = getDb().select().from(notes).get();
    expect(note?.content).toBe("手机捕获接口验收");
    expect(note?.aiStatus).toBe("pending");
  });

  it("缺少 Token、错误权限和已吊销 Token 均返回 401", async () => {
    expect((await post(null, { content: "无 Token" })).status).toBe(401);

    const readToken = createApiToken("knowledge:read");
    expect((await post(readToken.token, { content: "错误权限" })).status).toBe(401);

    const captureToken = createApiToken("capture:write");
    revokeApiToken(captureToken.record.id);
    expect((await post(captureToken.token, { content: "已吊销" })).status).toBe(401);
  });

  it("空内容返回 400 且不创建笔记", async () => {
    const created = createApiToken("capture:write");
    const response = await post(created.token, { content: "" });

    expect(response.status).toBe(400);
    expect(getDb().select().from(notes).all()).toHaveLength(0);
  });

  it("超长内容返回 400 且不创建笔记", async () => {
    const created = createApiToken("capture:write");
    const response = await post(created.token, { content: "x".repeat(100_001) });

    expect(response.status).toBe(400);
    expect(getDb().select().from(notes).all()).toHaveLength(0);
  });
});
