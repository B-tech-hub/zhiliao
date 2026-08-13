import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// 无需登录即可访问的路径
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = token ? await verifySessionToken(token) : false;

  if (ok) {
    // 已登录访问登录页时跳回首页
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const loginUrl = new URL("/login", req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 排除静态资源与 PWA 公共资源：浏览器抓取 manifest/图标不携带 cookie，必须免登录放行，
  // 否则 302 到 /login 导致 PWA 安装与 SW 更新失败；放行的均为无业务数据的静态壳资源
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest\\.webmanifest|sw\\.js|offline\\.html|apple-touch-icon\\.png|robots\\.txt|icons/).*)",
  ],
};
