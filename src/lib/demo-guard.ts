import { NextResponse } from "next/server";

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

export function demoForbiddenResponse() {
  return NextResponse.json({ error: "体验模式不支持此操作" }, { status: 403 });
}
