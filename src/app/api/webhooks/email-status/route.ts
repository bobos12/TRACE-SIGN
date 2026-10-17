import { NextResponse } from "next/server";
import { z } from "zod";
import { createHmac } from "crypto";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { recordDeliveryStatus } from "@/lib/mail/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional delivery-status webhook for providers or relays that can report outcomes.
 * Body: {"messageId":"<ts.…@trace-studio.tech>","event":"delivered"|"bounced","detail":"…"}
 * Header: X-TraceSign-Signature: hex HMAC-SHA256 of the raw body using EMAIL_WEBHOOK_SECRET.
 * Plain SMTP providers (e.g. Hostinger) don't send these; bounces are detected over IMAP instead.
 */
export async function POST(req: Request) {
  const secret = env.webhookSecret();
  if (!secret) return NextResponse.json({ error: "Webhook not enabled" }, { status: 404 });
  const raw = await req.text();
  const sig = req.headers.get("x-tracesign-signature") ?? "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (!safeEqual(sig, expected)) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  const b = z.object({ messageId: z.string().min(3).max(300), event: z.enum(["delivered", "bounced"]), detail: z.string().max(500).optional() }).safeParse(JSON.parse(raw || "{}"));
  if (!b.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const r = await recordDeliveryStatus(b.data.messageId, b.data.event, b.data.detail);
  return NextResponse.json({ ok: !!r });
}
