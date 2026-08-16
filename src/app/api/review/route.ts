import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { enqueueWeeklyReview, lastWeekRange, setWeeklyReviewEnabled } from "@/lib/ai/weekly-review";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ enabled: z.boolean() });

// 每周回顾开关（默认开启，关掉后每小时的对表直接跳过）
export async function PATCH(req: NextRequest) {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  setWeeklyReviewEnabled(getDb(), parsed.data.enabled);
  return NextResponse.json({ ok: true });
}

/* 「立即生成上周回顾」：只入队，生成本身交给 worker——一次回顾要读上百条笔记
   再等模型写完，占着 HTTP 请求几十秒不合适。queued=false 表示已有任务在跑。 */
export async function POST() {
  const queued = enqueueWeeklyReview(getDb(), lastWeekRange());
  return NextResponse.json({ queued });
}
