import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { conversations, messages, notes, topics } from "@/db/schema";
import { newId } from "@/lib/ids";
import { extractImageFilenames } from "@/lib/image-refs";
import { chatStream, type ChatContentPart, type MultiModalChatMessage } from "@/lib/llm";
import { getVisionConfig, isVisionConfigured } from "@/lib/llm-config";

export const dynamic = "force-dynamic";

// 上下文注入上限（字符），超出截断并在 prompt 中说明
const MAX_CONTEXT_CHARS = 12000;
const MAX_HISTORY = 20;
const MAX_IMAGES = 4;

const bodySchema = z.object({
  conversationId: z.string().optional(),
  scopeType: z.enum(["note", "topic"]),
  scopeId: z.string().min(1),
  message: z.string().min(1),
  useVision: z.boolean().optional(),
});

// 拼装围绕笔记/主题的上下文文本
function buildContext(scopeType: "note" | "topic", scopeId: string): { context: string; truncated: boolean; imageFiles: string[] } {
  const db = getDb();
  if (scopeType === "note") {
    const note = db
      .select()
      .from(notes)
      .where(and(eq(notes.id, scopeId), isNull(notes.deletedAt)))
      .get();
    if (!note) return { context: "", truncated: false, imageFiles: [] };
    const full = `# ${note.title || "（无标题笔记）"}\n\n${note.content}`;
    const truncated = full.length > MAX_CONTEXT_CHARS;
    // 提取笔记中引用的本地图片文件名，供视觉模型读取
    const imageFiles = extractImageFilenames(note.content);
    return { context: truncated ? full.slice(0, MAX_CONTEXT_CHARS) : full, truncated, imageFiles };
  }
  const topic = db.select().from(topics).where(eq(topics.id, scopeId)).get();
  if (!topic) return { context: "", truncated: false, imageFiles: [] };
  const rows = db
    .select({ title: notes.title, summary: notes.summary, content: notes.content })
    .from(notes)
    .where(and(eq(notes.topicId, scopeId), isNull(notes.deletedAt)))
    .orderBy(desc(notes.updatedAt))
    .all();
  let context = `主题：${topic.name}\n共 ${rows.length} 条笔记：\n\n`;
  let truncated = false;
  for (const n of rows) {
    const piece = `- ${n.title || "（无标题）"}：${n.summary || n.content.slice(0, 200).replace(/\n/g, " ")}\n`;
    if (context.length + piece.length > MAX_CONTEXT_CHARS) {
      truncated = true;
      break;
    }
    context += piece;
  }
  return { context, truncated, imageFiles: [] };
}

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

// AI 对话：SSE 流式返回，assistant 消息在流结束时一次性落库（避免逐 token 同步写阻塞事件循环）
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { scopeType, scopeId, message, useVision } = parsed.data;
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

  const history = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_HISTORY)
    .all()
    .reverse();

  // 用户消息先落库，流失败也不丢
  db.insert(messages)
    .values({ id: newId(), conversationId, role: "user", content: message, createdAt: now })
    .run();
  db.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversationId)).run();

  const { context, truncated, imageFiles } = buildContext(scopeType, scopeId);
  const wantVision = Boolean(useVision) && imageFiles.length > 0 && isVisionConfigured();

  const system =
    "你是个人知识库的 AI 助手。以下是用户当前正在查看的" +
    (scopeType === "note" ? "笔记" : "主题") +
    "内容，请基于这些内容回答问题；内容之外的信息如需推测请说明。" +
    (truncated ? "（注意：内容过长已被截断）" : "") +
    "\n\n---\n" +
    context;

  const chatMessages: MultiModalChatMessage[] = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
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

  const encoder = new TextEncoder();
  const convId = conversationId;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let assistantText = "";
      try {
        for await (const delta of chatStream(chatMessages, llmOpts)) {
          assistantText += delta;
          send({ delta });
        }
        send({ done: true, conversationId: convId });
      } catch (e) {
        // 客户端中止不算错误；其余错误告知前端
        if (!req.signal.aborted) {
          send({ error: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        // 已生成的部分（含中途停止）一次性落库
        if (assistantText) {
          const t = Date.now();
          db.insert(messages)
            .values({ id: newId(), conversationId: convId, role: "assistant", content: assistantText, createdAt: t })
            .run();
          db.update(conversations).set({ updatedAt: t }).where(eq(conversations.id, convId)).run();
        }
        try {
          controller.close();
        } catch {
          // 已关闭则忽略
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 反向代理（nginx 等）禁用缓冲，保证流式到达
      "X-Accel-Buffering": "no",
    },
  });
}
