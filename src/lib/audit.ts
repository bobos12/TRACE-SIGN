// Append-only, tamper-evident audit log.
//
// Each event stores seq, the previous event's hash, and an HMAC-SHA256 over its
// own content plus that previous hash (key: SESSION_SECRET). Changing, deleting
// or reordering any event breaks every later link, and events can't be forged
// without the server secret. verifyAuditChain() recomputes the chain.

import { asc, desc, eq, sql } from "drizzle-orm";
import { db, t } from "./db";
import { hmac, safeEqual } from "./crypto";

export interface EventInput {
  detail?: string | null;
  actor?: string | null; // "system", "sender:<email>", "recipient:<email>", "api:<key prefix>"
  recipientId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

type Row = typeof t.documentEvents.$inferSelect;

function digest(e: Pick<Row, "seq" | "documentId" | "type" | "detail" | "actor" | "recipientId" | "ip" | "userAgent" | "prevHash"> & { createdAt: Date }) {
  const body = JSON.stringify([
    e.seq,
    e.documentId,
    e.type,
    e.detail ?? null,
    e.actor ?? null,
    e.recipientId ?? null,
    e.ip ?? null,
    e.userAgent ?? null,
    e.createdAt.toISOString(),
    e.prevHash ?? "",
  ]);
  return hmac("audit-chain", body);
}

// One writer per document at a time inside this process; across processes the
// unique-ish (document, seq) race is caught and retried below.
const chains = new Map<string, Promise<unknown>>();

export async function recordEvent(documentId: string, type: string, input: EventInput = {}): Promise<void> {
  const prev = chains.get(documentId) ?? Promise.resolve();
  const run = prev.then(() => appendEvent(documentId, type, input)).catch((e) => console.error("audit append failed:", (e as Error).message));
  chains.set(documentId, run);
  await run;
  if (chains.get(documentId) === run) chains.delete(documentId);
}

async function appendEvent(documentId: string, type: string, input: EventInput) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const [last] = await db
      .select({ seq: t.documentEvents.seq, hash: t.documentEvents.hash })
      .from(t.documentEvents)
      .where(eq(t.documentEvents.documentId, documentId))
      .orderBy(desc(sql`coalesce(${t.documentEvents.seq}, 0)`), desc(t.documentEvents.createdAt))
      .limit(1);
    const seq = (last?.seq ?? 0) + 1;
    const createdAt = new Date();
    const row = {
      documentId,
      type,
      seq,
      detail: input.detail?.slice(0, 1000) ?? null,
      actor: input.actor?.slice(0, 200) ?? null,
      recipientId: input.recipientId ?? null,
      ip: input.ip?.slice(0, 64) ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      prevHash: last?.hash ?? null,
      createdAt,
    };
    const hash = digest(row);
    const [dup] = await db
      .select({ id: t.documentEvents.id })
      .from(t.documentEvents)
      .where(sql`${t.documentEvents.documentId} = ${documentId} and ${t.documentEvents.seq} = ${seq}`)
      .limit(1);
    if (dup) continue;
    try {
      await db.insert(t.documentEvents).values({ ...row, hash });
    } catch (e) {
      // (document_id, seq) is unique: another process appended first. Re-read the head and retry.
      if (/unique|duplicate/i.test((e as Error).message)) continue;
      throw e;
    }
    await db.update(t.documents).set({ lastActivityAt: createdAt }).where(eq(t.documents.id, documentId));
    return;
  }
  throw new Error("Could not append audit event (concurrent writers).");
}

export async function listEvents(documentId: string): Promise<Row[]> {
  return db
    .select()
    .from(t.documentEvents)
    .where(eq(t.documentEvents.documentId, documentId))
    .orderBy(asc(sql`coalesce(${t.documentEvents.seq}, 0)`), asc(t.documentEvents.createdAt));
}

export interface ChainReport {
  ok: boolean;
  sealedEvents: number;
  legacyEvents: number;
  brokenAt?: number;
  head?: string | null;
}

/** Recomputes the HMAC chain. Events written before v2 (no hash) are reported as legacy. */
export async function verifyAuditChain(documentId: string): Promise<ChainReport> {
  const rows = await listEvents(documentId);
  let prevHash: string | null = null;
  let sealed = 0;
  let legacy = 0;
  for (const r of rows) {
    if (!r.hash || r.seq == null) {
      legacy++;
      continue;
    }
    const expected = digest({ ...r, prevHash: r.prevHash, createdAt: r.createdAt });
    if ((r.prevHash ?? null) !== prevHash || !safeEqual(expected, r.hash)) {
      return { ok: false, sealedEvents: sealed, legacyEvents: legacy, brokenAt: r.seq, head: prevHash };
    }
    prevHash = r.hash;
    sealed++;
  }
  return { ok: true, sealedEvents: sealed, legacyEvents: legacy, head: prevHash };
}
