import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionToken } from "@/lib/auth";

const bodySchema = z.object({ password: z.string().min(1) });

// 登录限流：每个 IP 15 分钟内最多失败 10 次（进程内存计数，单实例足够）
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const rec = failures.get(ip);
  if (!rec || Date.now() - rec.windowStart > WINDOW_MS) return false;
  return rec.count >= MAX_FAILURES;
}

function recordFailure(ip: string) {
  const rec = failures.get(ip);
  if (!rec || Date.now() - rec.windowStart > WINDOW_MS) {
    failures.set(ip, { count: 1, windowStart: Date.now() });
  } else {
    rec.count += 1;
  }
}

// 先各自做 sha256 再比较，避免长度不同导致 timingSafeEqual 抛错，同时保持恒定时间
function passwordMatches(input: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "尝试次数过多，请 15 分钟后再试" }, { status: 429 });
  }

  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "服务端未配置 APP_PASSWORD" }, { status: 500 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请输入密码" }, { status: 400 });
  }

  if (!passwordMatches(parsed.data.password, expected)) {
    recordFailure(ip);
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  failures.delete(ip);

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
