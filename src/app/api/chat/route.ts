import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { buildSystemMessage } from "@/lib/ai/chat-context";
import { buildLlmMessages, type ToolLoopDeps } from "@/lib/ai/chat-loop";
import { createChatSseResponse } from "@/lib/ai/chat-stream";
import { extractUrls } from "@/lib/ai/fetch-url";
import { getTool, runTool, toolDefs, type ToolContext } from "@/lib/ai/tools";
import { newId } from "@/lib/ids";
import { chatStream, type ChatContentPart, type LlmMessage } from "@/lib/llm";
import { getToolSupport, getVisionConfig, isVisionConfigured } from "@/lib/llm-config";

export const dynamic = "force-dynamic";

const MAX_HISTORY = 20;
const MAX_IMAGES = 4;

const bodySchema = z.object({
  conversationId: z.string().optional(),
  scopeType: z.enum(["note", "topic", "global"]),
  // 全局助手没有作用域对象；note/topic 必填，在下方校验
  scopeId: z.string().optional(),
  message: z.string().min(1),
  useVision: z.boolean().optional(),
});

// 将本地图片文件读为 data URL（视觉模型输入）
function loadImagesAsDataUrls(filenames: string[]): string[] {
  const dir = process.env.UPLOAD_DIR || "./data/uploads";
  const urls: string[] = [];
  for (const name of filenames.slice(0, MAX_IMAGES)) {
    try {
      const buf = fs.readFileSync(path.join(dir, path.basename(name)));
      const ext = path.extname(name).slice(1).toLowerCase();
      const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      urls.push(`data:${mime};base64,${buf.toString("base64")}`);
    } catch {
      // 文件缺失时跳过
    }
  }
  return urls;
}

/* AI 助手对话：SSE 流式返回。
   模型可在多轮里调用工具，每轮的 assistant 文本与工具结果都即时落库——
   用户中途关闭页面时已执行的写操作必须留下操作卡片，否则无从撤销。 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { scopeType, message, useVision } = parsed.data;
  const scopeId = parsed.data.scopeId ?? "";
  if (scopeType !== "global" && !scopeId) {
    return NextResponse.json({ error: "缺少 scopeId" }, { status: 400 });
  }
  const db = getDb();
  const now = Date.now();

  // 会话：给定则校验存在，否则新建（标题取首条消息前 30 字）
  let conversationId = parsed.data.conversationId ?? null;
  if (conversationId) {
    const conv = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
    if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  } else {
    conversationId = newId();
    db.insert(conversations)
      .values({ id: conversationId, scopeType, scopeId, title: message.slice(0, 30), createdAt: now, updatedAt: now })
      .run();
  }
  const convId = conversationId;

  const history = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_HISTORY)
    .all()
    .reverse();

  /* fetch_url 的白名单取自全部历史 user 消息，而非上面截断过的 20 条：
     用户在第 3 条消息里给的链接，第 30 条才让助手打开是完全正常的用法。
     漏填会让 fetch_url 100% 被拒，且错误信息看起来像是模型用错了工具。 */
  const userUrls = db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.conversationId, convId), eq(messages.role, "user")))
    .all()
    .flatMap((m) => extractUrls(m.content))
    .concat(extractUrls(message));

  /* 落库时间戳严格递增，起点须大于会话已有消息的最大 createdAt。
     同毫秒内落多条时若都用 Date.now()，按 createdAt 排序会乱序，
     重建历史时 tool_calls 与结果配对错位。 */
  const startSeq = Math.max(now, (history.at(-1)?.createdAt ?? 0) + 1);

  // 用户消息先落库，流失败也不丢
  db.insert(messages)
    .values({ id: newId(), conversationId: convId, role: "user", content: message, createdAt: now })
    .run();
  db.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, convId)).run();

  const { system, imageFiles } = buildSystemMessage(scopeType, scopeId);
  const wantVision = Boolean(useVision) && imageFiles.length > 0 && isVisionConfigured();

  const chatMessages: LlmMessage[] = [
    { role: "system", content: system },
    ...buildLlmMessages(history),
  ];
  if (wantVision) {
    const parts: ChatContentPart[] = [
      { type: "text", text: message },
      ...loadImagesAsDataUrls(imageFiles).map(
        (url): ChatContentPart => ({ type: "image_url", image_url: { url } }),
      ),
    ];
    chatMessages.push({ role: "user", content: parts });
  } else {
    chatMessages.push({ role: "user", content: message });
  }

  // 只取端点三元组：sources/hasDbConfig 是设置页展示用字段，不能带进 LLM 调用
  const visionCfg = wantVision ? getVisionConfig() : null;
  const llmOpts = visionCfg
    ? {
        baseUrl: visionCfg.baseUrl,
        apiKey: visionCfg.apiKey,
        model: visionCfg.model,
        signal: req.signal,
      }
    : { signal: req.signal };

  /* 两种情况不发 tools：探测确认过供应商不支持（发了会 400），
     以及走视觉端点时（视觉模型普遍不支持 function calling，
     且看图问答本就不需要写库）。getToolSupport() 为 null 表示从未探测过，
     此时照常发送——多数供应商是支持的，不该因为没测过就降级。 */
  const tools = getToolSupport() === false || wantVision ? [] : toolDefs();

  const toolCtx: ToolContext = { db, userUrls, signal: req.signal };
  const deps: ToolLoopDeps = {
    stream: (msgs) => chatStream(msgs, { ...llmOpts, tools }),
    execute: (call) => runTool(call.name, call.args, toolCtx),
    requiresConfirm: (name) => Boolean(getTool(name)?.requiresConfirm),
  };

  return createChatSseResponse({
    db,
    conversationId: convId,
    startSeq,
    signal: req.signal,
    initial: chatMessages,
    deps,
  });
}
