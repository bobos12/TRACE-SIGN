// Outgoing webhooks for CRM integration.
// Each event is queued per endpoint (idempotent), POSTed as JSON and signed:
//   X-TraceSign-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
// Retries with backoff on network errors and non-2xx responses.

import { createHmac } from "crypto";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, t } from "./db";
import { decryptSecret, encryptSecret, randomSecret } from "./crypto";
import { withLock } from "./locks";

export const WEBHOOK_EVENTS = [
  "document.sent",
  "recipient.viewed",
  "recipient.signed",
  "recipient.declined",
  "document.completed",
  "document.declined",
  "document.expired",
  "document.voided",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 3600_000];
const MAX_ATTEMPTS = 6;

export async function createEndpoint(orgId: string, url: string, events: string[]) {
  const u = new URL(url);
  if (u.protocol !== "https:" && !(u.hostname === "localhost" || u.hostname === "127.0.0.1")) throw new Error("Webhook URLs must use https.");
  const secret = `whsec_${randomSecret(24)}`;
  const [row] = await db
    .insert(t.webhookEndpoints)
    .values({ orgId, url: u.toString(), secretEnc: encryptSecret(secret), events: events.length ? events.join(",") : "*" })
    .returning();
  return { endpoint: row, secret };
}

function wants(events: string, e: string) {
  return events === "*" || events.split(",").includes(e);
}

export async function emitWebhook(orgId: string, event: WebhookEvent, key: string, data: Record<string, unknown>) {
  const endpoints = await db.select().from(t.webhookEndpoints).where(and(eq(t.webhookEndpoints.orgId, orgId), eq(t.webhookEndpoints.active, true)));
  for (const ep of endpoints) {
    if (!wants(ep.events, event)) continue;
    const payload = JSON.stringify({ id: `${event}:${key}`, event, createdAt: new Date().toISOString(), data });
    await db
      .insert(t.webhookDeliveries)
      .values({ endpointId: ep.id, idempotencyKey: `${ep.id}:${event}:${key}`, event, payload })
      .onConflictDoNothing({ target: t.webhookDeliveries.idempotencyKey });
  }
}

export function signPayload(secret: string, body: string, ts = Math.floor(Date.now() / 1000)) {
  return `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
}

export async function processWebhooks(limit = 25) {
  return withLock("webhooks", 5 * 60_000, async () => {
    const due = await db
      .select({ d: t.webhookDeliveries, ep: t.webhookEndpoints })
      .from(t.webhookDeliveries)
      .innerJoin(t.webhookEndpoints, eq(t.webhookDeliveries.endpointId, t.webhookEndpoints.id))
      .where(and(inArray(t.webhookDeliveries.status, ["queued", "retrying"]), lte(t.webhookDeliveries.nextAttemptAt, new Date())))
      .orderBy(asc(t.webhookDeliveries.createdAt))
      .limit(limit);
    let sent = 0;
    let failed = 0;
    for (const { d, ep } of due) {
      const claimed = await db
        .update(t.webhookDeliveries)
        .set({ status: "sending", attempts: sql`${t.webhookDeliveries.attempts} + 1` })
        .where(and(eq(t.webhookDeliveries.id, d.id), inArray(t.webhookDeliveries.status, ["queued", "retrying"])))
        .returning({ id: t.webhookDeliveries.id });
      if (!claimed.length) continue;
      const attempts = d.attempts + 1;
      let code: number | null = null;
      let err: string | null = null;
      try {
        const res = await fetch(ep.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "TRACE.SIGN-Webhooks/2",
            "X-TraceSign-Event": d.event,
            "X-TraceSign-Delivery": d.id,
            "X-TraceSign-Signature": signPayload(decryptSecret(ep.secretEnc), d.payload),
          },
          body: d.payload,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        code = res.status;
        if (res.status < 200 || res.status >= 300) err = `HTTP ${res.status}`;
      } catch (e) {
        err = (e as Error).message.slice(0, 300);
      }
      if (!err) {
        await db.update(t.webhookDeliveries).set({ status: "sent", responseCode: code, deliveredAt: new Date(), lastError: null }).where(eq(t.webhookDeliveries.id, d.id));
        sent++;
      } else {
        const retry = attempts < MAX_ATTEMPTS;
        await db
          .update(t.webhookDeliveries)
          .set({
            status: retry ? "retrying" : "failed",
            responseCode: code,
            lastError: err,
            nextAttemptAt: new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]),
          })
          .where(eq(t.webhookDeliveries.id, d.id));
        failed++;
      }
    }
    return { sent, failed };
  });
}
