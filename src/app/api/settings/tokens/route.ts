import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiToken, listApiTokens, revokeApiToken, API_TOKEN_SCOPES } from "@/lib/api-token";

const createSchema = z.object({ scope: z.enum(API_TOKEN_SCOPES) });

export async function GET() {
  return NextResponse.json({ tokens: listApiTokens().map((t) => ({ id: t.id, scope: t.scope, prefix: t.tokenPrefix, last4: t.tokenLast4, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt })) });
}

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "权限范围无效" }, { status: 400 });
  const created = createApiToken(parsed.data.scope);
  return NextResponse.json({ token: created.token, tokenInfo: { id: created.record.id, scope: created.record.scope, prefix: created.record.tokenPrefix, last4: created.record.tokenLast4, createdAt: created.record.createdAt } }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !revokeApiToken(id)) return NextResponse.json({ error: "Token 不存在或已吊销" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
