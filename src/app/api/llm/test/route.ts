import { NextRequest, NextResponse } from "next/server";
import { testImageConnection } from "@/lib/image-gen";
import {
  isLlmConfigured,
  probeToolSupport,
  testConnection,
  testReasoningConnection,
  testVisionConnection,
} from "@/lib/llm";
import { saveReasoningToolSupport, saveToolSupport } from "@/lib/llm-config";
import { isEmbeddingConfigured } from "@/lib/llm-config";
import { testEmbeddingConnection } from "@/lib/ai/embedding";

// LLM 连通性测试（设置页“测试连接”按钮）
// body 可传 { target: "text" | "vision" | "image" | "reasoning" }；缺省或解析失败一律按 text，保证老前端兼容
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const raw = (body as { target?: string } | null)?.target;
  const target =
    raw === "vision" || raw === "image" || raw === "reasoning" || raw === "embedding" ? raw : "text";

  if (target === "embedding") {
    if (!isEmbeddingConfigured()) {
      return NextResponse.json({ ok: false, message: "Embedding 未配置：请填写接入点、API Key 与模型名" });
    }
    return NextResponse.json(await testEmbeddingConnection());
  }

  if (target === "vision") {
    return NextResponse.json(await testVisionConnection());
  }
  // 图像测试会真的生成一张图并因此计费，按钮旁已注明
  if (target === "image") {
    return NextResponse.json(await testImageConnection());
  }
  /* 深度思考：连通性与工具能力一次测完。结论必须单独落库——
     助手据此决定开着深度思考时要不要下发工具（含生图） */
  if (target === "reasoning") {
    const result = await testReasoningConnection();
    if (result.ok && typeof result.supportsTools === "boolean") {
      saveReasoningToolSupport(result.supportsTools);
    }
    return NextResponse.json(result);
  }

  if (!isLlmConfigured()) {
    return NextResponse.json({ ok: false, message: "LLM 未配置：请在设置页填写，或设置环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL" });
  }

  const conn = await testConnection();
  if (!conn.ok) return NextResponse.json(conn);

  // 连通后顺带探测工具调用能力：结果落库，AI 助手据此决定是否降级为纯问答
  const probe = await probeToolSupport();
  saveToolSupport(probe.supported);
  return NextResponse.json({
    ok: true,
    message: `${conn.message}；${probe.message}`,
    supportsTools: probe.supported,
  });
}
