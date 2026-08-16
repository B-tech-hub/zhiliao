// 向笔记正文末尾追加一段内容。
// 服务端做读-改-写，客户端只发要追加的那一段——由客户端先 GET 再 PATCH 的话，
// 两次请求之间笔记若被改动（编辑器的防抖自动保存、后台 AI 回写），改动会被整段覆盖。

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { NoteWriteError, updateNote } from "@/lib/note-write";

const schema = z.object({ text: z.string().min(1) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }

  const db = getDb();
  const note = db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .get();
  if (!note) return NextResponse.json({ error: "笔记不存在或已在回收站" }, { status: 404 });

  try {
    // 写入路径统一走 note-write（FTS 同步 / 锁字段 / AI 重新入队）
    updateNote(db, id, { content: `${note.content.trimEnd()}\n\n${parsed.data.text.trim()}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NoteWriteError) {
      return NextResponse.json({ error: e.message }, { status: e.code === "not_found" ? 404 : 400 });
    }
    throw e;
  }
}
