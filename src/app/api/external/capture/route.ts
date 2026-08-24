import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { createNote, NoteWriteError } from "@/lib/note-write";
import { authenticateApiToken, getBearerToken } from "@/lib/api-token";

const schema = z.object({ content: z.string().min(1), topicId: z.string().optional() });

export async function POST(req: NextRequest) {
  if (!authenticateApiToken(getBearerToken(req), "capture:write")) return NextResponse.json({ error: "无效或无权限的 Token" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "content 不能为空" }, { status: 400 });
  try {
    const note = createNote(getDb(), { ...parsed.data, deferAi: false });
    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    if (error instanceof NoteWriteError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
