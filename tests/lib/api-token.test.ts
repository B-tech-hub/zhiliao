import { describe, expect, it } from "vitest";
import { createApiToken, authenticateApiToken, revokeApiToken } from "@/lib/api-token";
import { getDb } from "@/db";
import { apiTokens } from "@/db/schema";

describe("api token", () => {
  it("只保存哈希并按权限认证", () => {
    const created = createApiToken("capture:write");
    const row = getDb().select().from(apiTokens).get();
    expect(created.token).not.toBe(row?.tokenHash);
    expect(authenticateApiToken(created.token, "capture:write")?.id).toBe(created.record.id);
    expect(authenticateApiToken(created.token, "knowledge:read")).toBeNull();
  });

  it("吊销后立即失效", () => {
    const created = createApiToken("knowledge:read");
    expect(revokeApiToken(created.record.id)).toBe(true);
    expect(authenticateApiToken(created.token, "knowledge:read")).toBeNull();
  });
});
