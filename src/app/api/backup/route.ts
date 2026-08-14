import { NextResponse } from "next/server";
import { doBackup, getLastBackupAt } from "@/lib/backup";

export const dynamic = "force-dynamic";

// 设置页「立即备份」：复用每日备份逻辑，进行中的备份自动合并（见 doBackup）
export async function POST() {
  try {
    await doBackup();
    return NextResponse.json({ ok: true, backedUpAt: getLastBackupAt() ?? Date.now() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `备份失败: ${message}` }, { status: 500 });
  }
}
