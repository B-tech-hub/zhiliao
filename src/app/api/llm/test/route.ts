import { NextResponse } from "next/server";
import { isLlmConfigured, testConnection } from "@/lib/llm";

// LLM 连通性测试（设置页“测试连接”按钮）
export async function POST() {
  if (!isLlmConfigured()) {
    return NextResponse.json({ ok: false, message: "LLM 未配置：请在设置页填写，或设置环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL" });
  }
  const result = await testConnection();
  return NextResponse.json(result);
}
