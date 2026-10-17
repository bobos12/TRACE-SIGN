import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { env, appHost } from "./env";
import { hmac, safeEqual, verifyPassword } from "./crypto";
import { db, t } from "./db";
import { DEFAULT_ORG } from "./org";
import { rateLimit } from "./ratelimit";

const COOKIE = "ts_admin";
const SESSION_HOURS = 12;

export type Role = "owner" | "admin" | "member";

export interface SessionUser {
  userId: string; // "env" for the built-in owner from .env
  email: string;
  name: string;
  orgId: string;
  role: Role;
}

function makeSession(u: SessionUser): string {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const body = `${Buffer.from(JSON.stringify(u)).toString("base64url")}.${exp}`;
  return `${body}.${hmac("admin-session-v2", body)}`;
}

function readSession(value: string | undefined): SessionUser | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const body = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], hmac("admin-session-v2", body))) return null;
  if (Number(parts[1]) < Date.now()) return null;
  try {
    const u = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as SessionUser;
    if (u.userId === "env" && u.email !== env.adminEmail()) return null; // ADMIN_EMAIL changed
    return u;
  } catch {
    return null;
  }
}

export async function checkLogin(email: string, password: string, ip: string): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const limited = rateLimit(`login:${ip}`, 8, 15 * 60_000);
  if (!limited.ok) return { ok: false, error: "Too many attempts. Try again in 15 minutes." };
  const e = email.trim().toLowerCase();
  if (e === env.adminEmail() && verifyPassword(password, env.adminPasswordHash())) {
    return { ok: true, user: { userId: "env", email: e, name: "Owner", orgId: DEFAULT_ORG, role: "owner" } };
  }
  const [u] = await db.select().from(t.users).where(and(eq(t.users.email, e), isNull(t.users.disabledAt)));
  if (u && verifyPassword(password, u.passwordHash)) {
    await db.update(t.users).set({ lastLoginAt: new Date() }).where(eq(t.users.id, u.id));
    return { ok: true, user: { userId: u.id, email: u.email, name: u.name, orgId: u.orgId, role: u.role as Role } };
  }
  return { ok: false, error: "Invalid email or password." };
}

export function setSessionCookie(res: NextResponse, user?: SessionUser) {
  const u = user ?? { userId: "env", email: env.adminEmail(), name: "Owner", orgId: DEFAULT_ORG, role: "owner" as Role };
  res.cookies.set(COOKIE, makeSession(u), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Session from the cookie (signature + expiry checked; no DB lookup). */
export function currentSession(): SessionUser | null {
  return readSession(cookies().get(COOKIE)?.value);
}

/** Kept for existing callers: the signed-in user's email. */
export function currentAdmin(): string | null {
  return currentSession()?.email ?? null;
}

/** Session confirmed against the database (catches users disabled after sign-in). */
export async function currentUser(): Promise<SessionUser | null> {
  const s = currentSession();
  if (!s) return null;
  if (s.userId === "env") return s;
  const [u] = await db.select().from(t.users).where(eq(t.users.id, s.userId));
  if (!u || u.disabledAt || u.orgId !== s.orgId) return null;
  return { ...s, role: u.role as Role, name: u.name };
}

/** For server-rendered admin pages. */
export async function requireUserPage(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Kept for existing callers. */
export function requireAdminPage(): string {
  const a = currentAdmin();
  if (!a) redirect("/login");
  return a;
}

export function canManage(u: SessionUser) {
  return u.role === "owner" || u.role === "admin";
}

/**
 * For admin API routes. Returns a 401/403 response to send back, or null when allowed.
 * Mutating requests must come from this app's own origin (CSRF protection).
 */
export function guardAdminApi(req: Request): NextResponse | null {
  if (!currentSession()) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = headers().get("host");
    const allowed = new Set([appHost(), host].filter(Boolean));
    let originHost = "";
    try {
      originHost = origin ? new URL(origin).host : "";
    } catch {
      originHost = "";
    }
    if (!originHost || !allowed.has(originHost)) {
      return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403 });
    }
  }
  return null;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();
}
