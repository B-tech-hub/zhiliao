import { NextRequest, NextResponse } from "next/server";
import { isLlmConfigured, testConnection, testVisionConnection } from "@/lib/llm";

// LLM 连通性测试（设置页“测试连接”按钮）
// body 可传 { target: "text" | "vision" }；缺省或解析失败一律按 text，保证老前端兼容
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const target = (body as { target?: string } | null)?.target === "vision" ? "vision" : "text";

  if (target === "vision") {
    return NextResponse.json(await testVisionConnection());
  }

  if (!isLlmConfigured()) {
    return NextResponse.json({ ok: false, message: "LLM 未配置：请在设置页填写，或设置环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL" });
  }
  return NextResponse.json(await testConnection());
}
