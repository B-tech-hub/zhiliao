import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { apiTokens } from "@/db/schema";
import { newId } from "@/lib/ids";

export const API_TOKEN_SCOPES = ["capture:write", "knowledge:read"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

const TOKEN_PREFIX = "zhl_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createApiToken(scope: ApiTokenScope): { token: string; record: typeof apiTokens.$inferSelect } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = Date.now();
  const record = {
    id: newId(),
    tokenHash: hashToken(token),
    tokenPrefix: TOKEN_PREFIX,
    tokenLast4: token.slice(-4),
    scope,
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
  };
  getDb().insert(apiTokens).values(record).run();
  return { token, record };
}

export function listApiTokens() {
  return getDb().select().from(apiTokens).where(isNull(apiTokens.revokedAt)).all();
}

export function revokeApiToken(id: string): boolean {
  const result = getDb().update(apiTokens).set({ revokedAt: Date.now() }).where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt))).run();
  return result.changes > 0;
}

export function authenticateApiToken(token: string | null | undefined, requiredScope?: ApiTokenScope) {
  if (!token) return null;
  const row = getDb().select().from(apiTokens).where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt))).get();
  if (!row || (requiredScope && row.scope !== requiredScope)) return null;
  getDb().update(apiTokens).set({ lastUsedAt: Date.now() }).where(eq(apiTokens.id, row.id)).run();
  return row;
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
