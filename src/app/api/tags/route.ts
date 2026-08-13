import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { tags } from "@/db/schema";

// 标签列表（编辑页自动补全等场景）
export async function GET() {
  const rows = getDb().select().from(tags).orderBy(asc(tags.name)).all();
  return NextResponse.json({ tags: rows.map((t) => t.name) });
}
