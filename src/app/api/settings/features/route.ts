import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  FEATURE_SETTING_KEYS,
  getFeatureFlags,
  setFeatureEnabled,
  type FeatureKey,
} from "@/lib/feature-flags";

const KEYS = Object.keys(FEATURE_SETTING_KEYS) as FeatureKey[];

function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && (KEYS as string[]).includes(value);
}

export async function GET() {
  return NextResponse.json(getFeatureFlags(getDb()));
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { feature?: unknown; enabled?: unknown } | null;
  if (!isFeatureKey(body?.feature)) {
    return NextResponse.json({ error: "feature 必须是四项功能之一" }, { status: 400 });
  }
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled 必须为布尔值" }, { status: 400 });
  }
  const db = getDb();
  setFeatureEnabled(db, body.feature, body.enabled);
  // 回带全量开关：界面据此刷新，省掉一次 GET
  return NextResponse.json(getFeatureFlags(db));
}
