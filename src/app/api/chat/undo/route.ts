// 撤销一次助手操作。操作卡片上的「撤销」按钮打到这里。
// 成功后把 toolPayload 标记为已撤销，重开会话时按钮保持置灰，
// 也防止同一次操作被反向执行两遍。

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { parseToolPayload } from "@/lib/ai/chat-loop";
import { undoToolAction } from "@/lib/ai/undo";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // 工具消息 id，由 {tool_end} 事件给出
  messageId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const db = getDb();

  const row = db.select().from(messages).where(eq(messages.id, parsed.data.messageId)).get();
  if (!row) return NextResponse.json({ error: "操作记录不存在" }, { status: 404 });

  const payload = parseToolPayload(row.toolPayload);
  if (payload?.kind !== "result" || !payload.undo) {
    return NextResponse.json({ error: "该操作不可撤销" }, { status: 400 });
  }
  if (payload.undone) {
    return NextResponse.json({ ok: true, reason: "已撤销过" });
  }

  const result = undoToolAction(db, payload.undo);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 409 });
  }

  db.update(messages)
    .set({ toolPayload: JSON.stringify({ ...payload, undone: true }) })
    .where(eq(messages.id, row.id))
    .run();

  return NextResponse.json({ ok: true });
}
