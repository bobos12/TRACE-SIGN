import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { canManage, currentUser, guardAdminApi, type SessionUser } from "./auth";
import { processOutbox } from "./mail/outbox";
import { DEFAULT_ORG } from "./org";
import { HttpError } from "./errors";

type Ctx = { params: Record<string, string> };

export { HttpError };

function toResponse(e: unknown) {
  if (e instanceof ZodError) {
    return NextResponse.json({ error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
  }
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, problems: (e as unknown as { problems?: unknown }).problems }, { status: e.status });
  console.error("api error:", (e as Error).message);
  return NextResponse.json({ error: (e as Error).message || "Request failed." }, { status: 400 });
}

/**
 * Wraps a signed-in API handler: session + CSRF check, DB-confirmed user, optional
 * role requirement, JSON errors without stack traces or secrets.
 */
export function userRoute(fn: (req: Request, ctx: Ctx, user: SessionUser) => Promise<unknown>, opts: { manage?: boolean; deploymentAdmin?: boolean } = {}) {
  return async (req: Request, ctx: Ctx) => {
    const blocked = guardAdminApi(req);
    if (blocked) return blocked;
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    if ((opts.manage || opts.deploymentAdmin) && !canManage(user)) return NextResponse.json({ error: "You need admin rights for this." }, { status: 403 });
    if (opts.deploymentAdmin && user.orgId !== DEFAULT_ORG) return NextResponse.json({ error: "Only the deployment owner can change this." }, { status: 403 });
    try {
      const out = await fn(req, ctx, user);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return toResponse(e);
    }
  };
}

/**
 * Legacy wrapper used by the Email Integration routes. Mailbox settings are
 * deployment-wide, so only owners/admins of the default workspace may use them.
 */
export function adminRoute(fn: (req: Request, ctx: Ctx) => Promise<unknown>) {
  return userRoute((req, ctx) => fn(req, ctx), { deploymentAdmin: true });
}

export { toResponse };

/** Try to deliver freshly queued email right away; the worker/cron catches anything left. */
export async function kickOutbox() {
  try {
    return await processOutbox({ limit: 25 });
  } catch (e) {
    console.error("outbox kick failed:", (e as Error).message);
    return null;
  }
}

// ── Integration API (Bearer API keys) ───────────────────────────────────

import { and as _and, eq as _eq, isNull as _isNull } from "drizzle-orm";
import { db as _db, t as _t } from "./db";
import { sha256Hex as _sha } from "./crypto";
import { rateLimit as _rateLimit } from "./ratelimit";

export interface ApiClient {
  orgId: string;
  keyId: string;
  prefix: string;
}

/** Wraps a /api/v1 handler: API key auth, per-key rate limit, JSON errors. */
export function apiKeyRoute(fn: (req: Request, ctx: Ctx, client: ApiClient) => Promise<unknown>) {
  return async (req: Request, ctx: Ctx) => {
    const auth = req.headers.get("authorization") ?? "";
    const key = auth.replace(/^Bearer\s+/i, "").trim();
    if (!key.startsWith("tsk_")) return NextResponse.json({ error: "Missing or malformed API key. Send Authorization: Bearer tsk_…" }, { status: 401 });
    const [row] = await _db
      .select()
      .from(_t.apiKeys)
      .where(_and(_eq(_t.apiKeys.keyHash, _sha(key)), _isNull(_t.apiKeys.revokedAt)));
    if (!row) return NextResponse.json({ error: "Invalid or revoked API key." }, { status: 401 });
    const rl = _rateLimit(`api:${row.id}`, 120, 60_000);
    if (!rl.ok) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await _db.update(_t.apiKeys).set({ lastUsedAt: new Date() }).where(_eq(_t.apiKeys.id, row.id));
    }
    try {
      const out = await fn(req, ctx, { orgId: row.orgId, keyId: row.id, prefix: row.prefix });
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return toResponse(e);
    }
  };
}

/** Public signing endpoints: same-origin check for mutations and a per-IP rate limit. */
export function publicGuard(req: Request, bucket: string, max = 60): NextResponse | null {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin) {
      let host = "";
      try {
        host = new URL(origin).host;
      } catch {
        host = "";
      }
      const allowed = new Set([appHostSafe(), req.headers.get("host")].filter(Boolean));
      if (!allowed.has(host)) return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403 });
    }
  }
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim();
  const rl = _rateLimit(`${bucket}:${ip}`, max, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests. Please wait a minute and try again." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  return null;
}

import { appHost as _appHost } from "./env";
function appHostSafe() {
  try {
    return _appHost();
  } catch {
    return "";
  }
}

/** Actor info for the audit log. */
export function actorFrom(req: Request, label: string) {
  return {
    label,
    ip: (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim(),
    userAgent: req.headers.get("user-agent") ?? "",
  };
}
export { canManage as canManageUser } from "./auth";
