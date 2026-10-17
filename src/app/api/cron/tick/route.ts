import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runTick } from "@/lib/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduler entry point: expiries, reminders, outbox, IMAP sync.
 * Call with "Authorization: Bearer <CRON_SECRET>" (Vercel Cron does this automatically).
 */
async function handle(req: Request) {
  const secret = env.cronSecret();
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(got, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runTick());
}

export const GET = handle;
export const POST = handle;
