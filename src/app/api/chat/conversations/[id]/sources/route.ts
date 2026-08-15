import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { conversations } from "@/db/schema";
import { describeSources, getConversationSources, setConversationSources } from "@/lib/ai/sources";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sources: z.array(z.object({ type: z.enum(["note", "topic"]), id: z.string().min(1) })),
});

/* 覆盖式更新来源集。会话进行中随时可改，下一条消息生效——
   已经产生的回答不会追溯重算，用户看到的历史仍是当时那批来源的产物。 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const db = getDb();
  const conv = db.select().from(conversations).where(eq(conversations.id, id)).get();
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (conv.scopeType !== "sources") {
    return NextResponse.json({ error: "该会话不是来源问答" }, { status: 400 });
  }

  setConversationSources(db, id, parsed.data.sources);
  return NextResponse.json({ sources: describeSources(db, getConversationSources(db, id)) });
}
