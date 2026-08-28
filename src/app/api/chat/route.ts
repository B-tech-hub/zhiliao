import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { conversations, conversationSources, messages } from "@/db/schema";
import { buildSystemMessage, type ChatScope } from "@/lib/ai/chat-context";
import { buildLlmMessages, type ToolLoopDeps } from "@/lib/ai/chat-loop";
import { createChatSseResponse } from "@/lib/ai/chat-stream";
import { extractUrls } from "@/lib/ai/fetch-url";
import { getTool, runTool, toolDefs, MAX_IMAGES_PER_MESSAGE, type ToolContext } from "@/lib/ai/tools";
import { newId } from "@/lib/ids";
import { chatStream, type ChatContentPart, type LlmMessage } from "@/lib/llm";
import {
  getToolSupport,
  getReasoningToolSupport,
  getVisionConfig,
  getReasoningConfig,
  isVisionConfigured,
} from "@/lib/llm-config";
import { isImageGenAvailable, isReasoningAvailable } from "@/lib/feature-flags";
import { prepareVisionImageDataUrls, VisionImageError } from "@/lib/vision-images";

export const dynamic = "force-dynamic";

const MAX_HISTORY = 20;

const bodySchema = z.object({
  conversationId: z.string().optional(),
  scopeType: z.enum(["note", "topic", "global", "sources"]),
  // 全局助手与来源问答没有作用域对象；note/topic 必填，在下方校验
  scopeId: z.string().optional(),
  // 来源问答新建会话时携带的来源集；续聊时忽略（以会话已存的为准）
  sources: z
    .array(z.object({ type: z.enum(["note", "topic"]), id: z.string().min(1) }))
    .optional(),
  message: z.string().min(1),
  useVision: z.boolean().optional(),
  useReasoning: z.boolean().optional(),
});

/* AI 助手对话：SSE 流式返回。
   模型可在多轮里调用工具，每轮的 assistant 文本与工具结果都即时落库——
   用户中途关闭页面时已执行的写操作必须留下操作卡片，否则无从撤销。 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { message, useVision, useReasoning } = parsed.data;
  const reqScopeType = parsed.data.scopeType;
  const reqScopeId = parsed.data.scopeId ?? "";
  // 只有 note/topic 有作用域对象；global 与 sources 的 scopeId 本就是空串
  if ((reqScopeType === "note" || reqScopeType === "topic") && !reqScopeId) {
    return NextResponse.json({ error: "缺少 scopeId" }, { status: 400 });
  }
  const db = getDb();
  const now = Date.now();

  /* 会话：给定则校验存在，否则新建（标题取首条消息前 30 字）。
     续聊时 scope 一律以会话自己存的为准，不用请求里的——
     请求里的 scope 跟着当前页面走，从历史里打开一个来源问答会话再发言时，
     用请求的 scope 会静默丢掉整个来源集，助手答非所问且毫无提示。 */
  let conversationId = parsed.data.conversationId ?? null;
  let scopeType: ChatScope = reqScopeType;
  let scopeId = reqScopeId;
  if (conversationId) {
    const conv = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
    if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    scopeType = conv.scopeType as ChatScope;
    scopeId = conv.scopeId;
  } else {
    conversationId = newId();
    const newConvId = conversationId;
    const sources = parsed.data.sources ?? [];
    db.transaction((tx) => {
      tx.insert(conversations)
        .values({ id: newConvId, scopeType, scopeId, title: message.slice(0, 30), createdAt: now, updatedAt: now })
        .run();
      if (scopeType === "sources" && sources.length > 0) {
        for (const s of sources) {
          tx.insert(conversationSources)
            .values({ conversationId: newConvId, sourceType: s.type, sourceId: s.id, createdAt: now })
            .run();
        }
      }
    });
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

  const { system, imageFiles, allowedNoteIds, sourcesMode } = buildSystemMessage(
    scopeType,
    scopeId,
    convId,
  );
  const reasoningCfg = useReasoning && isReasoningAvailable(db) ? getReasoningConfig() : null;
  const wantVision = Boolean(useVision) && imageFiles.length > 0 && (reasoningCfg ? Boolean(reasoningCfg.model) : isVisionConfigured());
  let visionImageUrls: string[] = [];
  if (wantVision) {
    try {
      visionImageUrls = await prepareVisionImageDataUrls(imageFiles);
    } catch (error) {
      if (error instanceof VisionImageError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  const chatMessages: LlmMessage[] = [
    { role: "system", content: system },
    ...buildLlmMessages(history),
  ];
  if (wantVision) {
    const parts: ChatContentPart[] = [
      { type: "text", text: message },
      ...visionImageUrls.map(
        (url): ChatContentPart => ({ type: "image_url", image_url: { url } }),
      ),
    ];
    chatMessages.push({ role: "user", content: parts });
  } else {
    chatMessages.push({ role: "user", content: message });
  }

  // 只取端点三元组：sources/hasDbConfig 是设置页展示用字段，不能带进 LLM 调用
  const visionCfg = wantVision && !reasoningCfg ? getVisionConfig() : null;
  const llmOpts = reasoningCfg ?? visionCfg
    ? {
        baseUrl: (reasoningCfg ?? visionCfg)!.baseUrl,
        apiKey: (reasoningCfg ?? visionCfg)!.apiKey,
        model: (reasoningCfg ?? visionCfg)!.model,
        signal: req.signal,
        timeoutMs: reasoningCfg ? 300000 : undefined,
        noTemperature: Boolean(reasoningCfg),
      }
    : { signal: req.signal };

  /* 两种情况不发 tools：探测确认过供应商不支持（发了会 400），
     以及走视觉端点时（视觉模型普遍不支持 function calling，
     且看图问答本就不需要写库）。探测结果为 null 表示从未探测过，
     此时照常发送——多数供应商是支持的，不该因为没测过就降级。
     深度思考走自己那份探测结论：推理模型与文本模型常常不是同一家。 */
  const grounded = scopeType === "sources";
  const toolSupport = reasoningCfg ? getReasoningToolSupport() : getToolSupport();
  const tools =
    toolSupport === false || wantVision
      ? []
      : toolDefs({ grounded, imageGen: isImageGenAvailable(db) });

  const toolCtx: ToolContext = {
    db,
    userUrls,
    allowedNoteIds: grounded ? new Set(allowedNoteIds ?? []) : undefined,
    // 一次请求 = 用户的一次发言，额度随之新建；模型幻觉出的调用同样受限
    imageBudget: { remaining: MAX_IMAGES_PER_MESSAGE },
    signal: req.signal,
  };
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
    // 来源问答：先告知前端本轮生效的来源笔记，供引用溯源放行
    prelude: grounded
      ? [{ grounding: { noteIds: allowedNoteIds ?? [], mode: sourcesMode ?? "empty" } }]
      : undefined,
  });
}
