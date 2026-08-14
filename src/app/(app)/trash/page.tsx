import { desc, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { TRASH_RETENTION_DAYS } from "@/lib/trash";
import { TrashClient } from "./trash-client";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;

// 回收站：入口在 设置 → 数据 区块；不进导航
export default function TrashPage() {
  const now = Date.now();
  const rows = getDb()
    .select()
    .from(notes)
    .where(isNotNull(notes.deletedAt))
    .orderBy(desc(notes.deletedAt))
    .limit(200)
    .all();

  const items = rows.map((n) => ({
    id: n.id,
    title: n.title,
    content: n.content,
    summary: n.summary,
    deletedAt: n.deletedAt!,
    remainingDays: Math.ceil((n.deletedAt! + TRASH_RETENTION_DAYS * DAY_MS - now) / DAY_MS),
  }));

  return <TrashClient notes={items} />;
}
