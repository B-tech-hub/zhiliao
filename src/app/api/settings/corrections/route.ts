import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { correctionExamples, settings } from "@/db/schema";
import { CORRECTION_LEARNING_SETTING, isCorrectionLearningEnabled } from "@/lib/correction-learning";

export async function GET() {
  const db = getDb();
  return NextResponse.json({ enabled: isCorrectionLearningEnabled(db), count: db.select().from(correctionExamples).all().length });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null) as { enabled?: boolean } | null;
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled 必须为布尔值" }, { status: 400 });
  const db = getDb();
  db.insert(settings).values({ key: CORRECTION_LEARNING_SETTING, value: body.enabled ? "1" : "0", updatedAt: Date.now() }).onConflictDoUpdate({ target: settings.key, set: { value: body.enabled ? "1" : "0", updatedAt: Date.now() } }).run();
  return NextResponse.json({ enabled: body.enabled });
}

export async function DELETE() {
  getDb().delete(correctionExamples).run();
  return NextResponse.json({ ok: true });
}
