import { NextResponse } from "next/server";
import { checkLogin, clientIp, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const r = await checkLogin(String(body.email ?? ""), String(body.password ?? ""), clientIp(req));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, r.user);
  return res;
}
