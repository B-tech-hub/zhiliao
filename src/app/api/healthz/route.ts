import { NextResponse } from "next/server";
import { getSqlite } from "@/db";

// 强制动态：防止 next build 时静态化预执行（会在构建机上打开数据库）
export const dynamic = "force-dynamic";

// 健康检查端点：middleware 已放行免登录，仅返回存活状态，不暴露版本/队列等内部信息
export function GET() {
  try {
    getSqlite().prepare("SELECT 1").get();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[healthz] 数据库探测失败:", e);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
