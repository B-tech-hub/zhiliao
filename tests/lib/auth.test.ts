import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth";

describe("auth", () => {
  it("签发的会话令牌能通过校验", async () => {
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
  });

  it("被篡改的令牌校验失败", async () => {
    const token = await createSessionToken();
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    expect(await verifySessionToken(tampered)).toBe(false);
  });

  it("更换 SESSION_SECRET 后旧令牌失效", async () => {
    const token = await createSessionToken();
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "another-secret-0123456789abcdef";
    try {
      expect(await verifySessionToken(token)).toBe(false);
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });

  it("SESSION_SECRET 过短时拒绝签发", async () => {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "short";
    try {
      await expect(createSessionToken()).rejects.toThrow("SESSION_SECRET");
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });
});
