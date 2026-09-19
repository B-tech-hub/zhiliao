import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { demoForbiddenResponse } from "@/lib/demo-guard";

// 无需登录即可访问的路径（healthz 供容器健康检查与外部监控探活）
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/healthz"];
const DEMO_FORBIDDEN_PATHS = new Set([
  "/api/settings/llm",
  "/api/settings/tokens",
  "/api/export",
  "/api/backup",
  "/api/embedding/backfill",
  "/api/import",
  "/api/llm/test",
  "/api/uploads",
]);
const MAX_DEMO_REQUEST_BYTES = 200 * 1024 * 1024;

function rejectInvalidDemoRequestBody(req: NextRequest): NextResponse | null {
  const rawContentLength = req.headers.get("content-length");
  const hasTransferEncoding = req.headers.has("transfer-encoding");
  if (rawContentLength !== null && hasTransferEncoding) {
    return NextResponse.json({ error: "不支持同时声明 Content-Length 和 Transfer-Encoding" }, { status: 400 });
  }
  if (rawContentLength === null) {
    // Next 会为空 DELETE 创建流；其余带正文的方法必须明确声明分帧方式。
    const bodyExpected = !["GET", "HEAD", "OPTIONS", "DELETE"].includes(req.method);
    if (!hasTransferEncoding && (!bodyExpected || !req.body)) return null;
    return NextResponse.json({ error: "体验模式请求必须提供 Content-Length" }, { status: 411 });
  }
  if (!/^\d+$/.test(rawContentLength)) {
    return NextResponse.json({ error: "Content-Length 无效" }, { status: 400 });
  }

  const contentLength = Number(rawContentLength);
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_DEMO_REQUEST_BYTES) {
    return NextResponse.json({ error: "请求体不能超过 200MB" }, { status: 413 });
  }
  return null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = token ? await verifySessionToken(token) : false;

  if (process.env.DEMO_MODE === "1" && ok && DEMO_FORBIDDEN_PATHS.has(pathname)) {
    return demoForbiddenResponse();
  }

  // Demo 在反向代理之外再做一层请求体上限保护，避免公开入口耗尽容器内存。
  if (process.env.DEMO_MODE === "1") {
    const rejected = rejectInvalidDemoRequestBody(req);
    if (rejected) return rejected;
  }

  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  // 外部 API/MCP 在各自路由内校验 Bearer Token。middleware 只负责放行到路由，
  // 避免把 Node-only 的 crypto 认证模块带进 Edge middleware 构建。
  if (!ok && (pathname.startsWith("/api/external/") || pathname === "/api/mcp")) return NextResponse.next();

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
