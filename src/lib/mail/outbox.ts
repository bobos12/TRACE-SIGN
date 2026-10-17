import { and, asc, eq, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { Attachment } from "nodemailer/lib/mailer";
import { db, t } from "../db";
import type { EmailMessage, EmailSettings } from "../schema";
import { appUrl } from "../env";
import { openBlob, signingToken } from "../crypto";
import { DEFAULT_ORG, getOrg } from "../org";
import { getSettings, smtpPassword, updateSettings } from "../settings";
import { withLock } from "../locks";
import { recordEvent } from "../audit";
import { buildTransport, describeSmtpError, makeMessageId, MailConfigError, type SmtpFailure } from "./transport";
import { logoAttachment, renderEmail, subjectFor, type EmailBrand, type EmailKind, type Payload } from "./templates";

/** Delay before attempt n+1 (index = attempts already made − 1). */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const STUCK_AFTER_MS = 10 * 60_000;
const PDF_NOT_READY = "Completed PDF is not available yet.";

export interface EnqueueInput {
  idempotencyKey: string;
  kind: EmailKind;
  toEmail: string;
  toName?: string | null;
  payload: Payload;
  documentId?: string | null;
  recipientId?: string | null;
}

export async function logEmailEvent(emailId: string, status: string, detail?: string | null) {
  await db.insert(t.emailEvents).values({ emailId, status, detail: detail ?? null });
}

async function setEmail(id: string, data: Partial<EmailMessage>) {
  await db.update(t.emailMessages).set(data).where(eq(t.emailMessages.id, id));
}

/**
 * Adds an email to the outbox exactly once. A second call with the same
 * idempotencyKey returns the existing row instead of creating a duplicate.
 */
export async function enqueueEmail(input: EnqueueInput): Promise<{ email: EmailMessage; created: boolean }> {
  const [row] = await db
    .insert(t.emailMessages)
    .values({
      idempotencyKey: input.idempotencyKey,
      kind: input.kind,
      toEmail: input.toEmail.trim().toLowerCase(),
      toName: input.toName ?? null,
      subject: subjectFor(input.kind, input.payload),
      payload: JSON.stringify(input.payload),
      documentId: input.documentId ?? null,
      recipientId: input.recipientId ?? null,
    })
    .onConflictDoNothing({ target: t.emailMessages.idempotencyKey })
    .returning();
  if (row) {
    await logEmailEvent(row.id, "queued");
    return { email: row, created: true };
  }
  const [existing] = await db.select().from(t.emailMessages).where(eq(t.emailMessages.idempotencyKey, input.idempotencyKey));
  return { email: existing, created: false };
}

/** Decide whether a queued email should still go out (e.g. an invite after the document was voided). */
async function stillRelevant(e: EmailMessage): Promise<string | null> {
  if (e.kind !== "invite" && e.kind !== "reminder") return null;
  if (!e.recipientId || !e.documentId) return "Recipient or document no longer exists.";
  const [row] = await db
    .select({ r: t.recipients, d: t.documents })
    .from(t.recipients)
    .innerJoin(t.documents, eq(t.recipients.documentId, t.documents.id))
    .where(eq(t.recipients.id, e.recipientId));
  if (!row) return "Recipient no longer exists.";
  if (row.d.status !== "sent") return `Document is ${row.d.status}; signing request no longer open.`;
  if (row.d.expiresAt && row.d.expiresAt < new Date()) return "Signing request has expired.";
  if (row.r.status === "signed" || row.r.status === "declined") return `Recipient already ${row.r.status}.`;
  return null;
}

/** Brand of the workspace that owns a document (default workspace for system mail). */
async function brandFor(documentId: string | null) {
  let orgId = DEFAULT_ORG;
  if (documentId) {
    const [d] = await db.select({ orgId: t.documents.orgId }).from(t.documents).where(eq(t.documents.id, documentId));
    if (d) orgId = d.orgId;
  }
  const org = await getOrg(orgId);
  const brand: EmailBrand = { name: org.brandName, company: org.name, accent: org.accentColor, poweredBy: true };
  return { org, brand };
}

const LINK_TTL_MS = 30 * 86400_000;

async function buildMessage(e: EmailMessage, s: EmailSettings) {
  const base = appUrl();
  const payload = JSON.parse(e.payload) as Payload;
  const { org, brand } = await brandFor(e.documentId);

  // Signing links are derived at send time from the recipient's current token version and
  // carry a MAC-protected expiry, so revoked links are never sent and no bearer links are stored.
  let signUrl: string | undefined;
  if (e.recipientId && ["invite", "reminder", "completed_pdf"].includes(e.kind)) {
    const [row] = await db
      .select({ r: t.recipients, exp: t.documents.expiresAt })
      .from(t.recipients)
      .innerJoin(t.documents, eq(t.recipients.documentId, t.documents.id))
      .where(eq(t.recipients.id, e.recipientId));
    if (row) {
      const ttl = Date.now() + LINK_TTL_MS;
      const until = e.kind !== "completed_pdf" && row.exp ? Math.min(row.exp.getTime() + 3600_000, ttl) : ttl;
      signUrl = `${base}/sign/${signingToken(row.r.id, row.r.tokenVersion, until)}`;
    }
  }
  const adminDocUrl = e.documentId ? `${base}/admin/documents/${e.documentId}` : undefined;
  const delivery = org.completionDelivery === "link" ? "link" : "attachment";
  const auditAttached = e.kind === "completed_pdf" && delivery === "attachment" && org.attachAuditToEmail;
  const rendered = renderEmail(e.kind as EmailKind, payload, { appUrl: base, signUrl, adminDocUrl, delivery, auditAttached }, brand);

  const attachments: Attachment[] = [logoAttachment(org.logoPng)];
  if (e.kind === "completed_pdf" && e.documentId) {
    const [d] = await db
      .select({ pdf: t.documents.completedPdf, audit: t.documents.auditPdf, title: t.documents.title })
      .from(t.documents)
      .where(eq(t.documents.id, e.documentId));
    if (!d?.pdf) throw new Error(PDF_NOT_READY);
    const base = d.title.replace(/[^\w\- ]+/g, "").trim() || "document";
    if (delivery === "attachment") {
      attachments.push({ filename: `${base} (signed).pdf`, content: openBlob(d.pdf)!, contentType: "application/pdf" });
      if (auditAttached && d.audit) attachments.push({ filename: `${base} (audit trail).pdf`, content: openBlob(d.audit)!, contentType: "application/pdf" });
    }
  }
  const fromName = org.emailFromName || (org.id === DEFAULT_ORG ? s.fromName : org.brandName);

  // Thread follow-ups under the original invitation so replies stay together.
  let inReplyTo: string | undefined;
  if (e.recipientId && e.kind !== "invite") {
    const [inv] = await db
      .select({ mid: t.emailMessages.messageId })
      .from(t.emailMessages)
      .where(and(eq(t.emailMessages.recipientId, e.recipientId), eq(t.emailMessages.kind, "invite"), isNotNull(t.emailMessages.messageId)))
      .orderBy(asc(t.emailMessages.createdAt))
      .limit(1);
    inReplyTo = inv?.mid ?? undefined;
  }

  return {
    from: { name: fromName, address: s.fromEmail },
    replyTo: s.replyTo || undefined,
    to: e.toName ? { name: e.toName, address: e.toEmail } : e.toEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments,
    inReplyTo,
    references: inReplyTo,
    // Envelope sender = the alias: SPF aligns with the sending domain and bounces return to the alias.
    envelope: { from: s.fromEmail, to: [e.toEmail] },
    headers: {
      "X-TraceSign-Email-Id": e.id,
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "OOF, AutoReply",
    },
  };
}

export interface ProcessResult {
  sent: number;
  failed: number;
  retrying: number;
  cancelled: number;
  paused?: string;
}

/** Sends due emails. Safe to call concurrently: a DB lease plus per-row claims prevent double sends. */
export async function processOutbox(opts: { limit?: number } = {}): Promise<ProcessResult | { skipped: true }> {
  return withLock("outbox", 5 * 60_000, () => processOutboxLocked(opts.limit ?? 25));
}

async function processOutboxLocked(limit: number): Promise<ProcessResult> {
  const res: ProcessResult = { sent: 0, failed: 0, retrying: 0, cancelled: 0 };
  const now = new Date();

  // A row left in "sending" means the process died mid-send. The server may or may not
  // have accepted it, so it is NOT resent automatically (that could duplicate an invite).
  const stuck = await db
    .update(t.emailMessages)
    .set({
      status: "failed",
      lockedAt: null,
      lastError: "Interrupted while sending; delivery is unknown. Not retried automatically to avoid a duplicate. Use Resend if the recipient did not receive it.",
    })
    .where(and(eq(t.emailMessages.status, "sending"), lt(t.emailMessages.lockedAt, new Date(now.getTime() - STUCK_AFTER_MS))))
    .returning({ id: t.emailMessages.id });
  for (const e of stuck) await logEmailEvent(e.id, "failed", "interrupted");

  const due = await db
    .select()
    .from(t.emailMessages)
    .where(and(inArray(t.emailMessages.status, ["queued", "retrying"]), lte(t.emailMessages.nextAttemptAt, now)))
    .orderBy(asc(t.emailMessages.createdAt))
    .limit(limit);
  if (!due.length) return res;

  const s = await getSettings();
  let transport;
  let pass = "";
  try {
    pass = smtpPassword(s) ?? "";
    transport = buildTransport(s, { pool: true });
  } catch (err) {
    const f = describeSmtpError(err);
    await updateSettings({ lastSmtpError: f.message });
    res.paused = f.message;
    return res;
  }

  try {
    for (const e of due) {
      const claimed = await db
        .update(t.emailMessages)
        .set({ status: "sending", lockedAt: new Date(), attempts: sql`${t.emailMessages.attempts} + 1` })
        .where(and(eq(t.emailMessages.id, e.id), inArray(t.emailMessages.status, ["queued", "retrying"])))
        .returning({ id: t.emailMessages.id });
      if (claimed.length !== 1) continue; // another worker took it
      const attempts = e.attempts + 1;

      const skip = await stillRelevant(e);
      if (skip) {
        await setEmail(e.id, { status: "cancelled", lockedAt: null, lastError: skip });
        await logEmailEvent(e.id, "cancelled", skip);
        res.cancelled++;
        continue;
      }

      const messageId = e.messageId ?? makeMessageId(e.id, s.fromEmail);
      if (!e.messageId) await setEmail(e.id, { messageId });

      try {
        const msg = await buildMessage(e, s);
        const info = await transport.sendMail({ ...msg, messageId });
        if (info.rejected?.length) {
          throw (info as { rejectedErrors?: Error[] }).rejectedErrors?.[0] ?? Object.assign(new Error(`Recipient rejected: ${String(info.rejected[0])}`), { command: "RCPT TO", responseCode: 550 });
        }
        await setEmail(e.id, { status: "sent", sentAt: new Date(), lockedAt: null, lastError: null, smtpResponse: String(info.response || "").slice(0, 300) });
        await logEmailEvent(e.id, "sent", attempts > 1 ? `Accepted by SMTP server on attempt ${attempts}` : "Accepted by SMTP server");
        res.sent++;
        if (s.aliasStatus === "unknown" || s.aliasStatus === "rejected") {
          await updateSettings({ aliasStatus: "ok", aliasDetail: `SMTP server accepted ${s.fromEmail} as sender.` });
          s.aliasStatus = "ok";
        }
      } catch (err) {
        const f: SmtpFailure =
          err instanceof MailConfigError || (err instanceof Error && err.message === PDF_NOT_READY)
            ? { code: "NOT_CONFIGURED", message: (err as Error).message, transient: true }
            : describeSmtpError(err, { fromEmail: s.fromEmail, smtpUser: s.smtpUser, secretsToRedact: [pass] });

        // Configuration problems aren't the email's fault: put it back untouched and pause the batch.
        if (f.code === "AUTH_FAILED" || f.code === "ALIAS_REJECTED") {
          await setEmail(e.id, { status: "queued", attempts: e.attempts, lockedAt: null, lastError: f.message, nextAttemptAt: new Date(Date.now() + 5 * 60_000) });
          await logEmailEvent(e.id, "paused", f.code);
          await updateSettings({ lastSmtpError: f.message, ...(f.code === "ALIAS_REJECTED" ? { aliasStatus: "rejected", aliasDetail: f.message } : {}) });
          res.paused = f.message;
          break;
        }

        const canRetry = f.transient && attempts < e.maxAttempts;
        await setEmail(
          e.id,
          canRetry
            ? { status: "retrying", lockedAt: null, lastError: `[${f.code}] ${f.message}`, nextAttemptAt: new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]) }
            : { status: "failed", lockedAt: null, lastError: `[${f.code}] ${f.message}` },
        );
        await logEmailEvent(e.id, canRetry ? "retrying" : "failed", `${f.code}: ${f.message}`.slice(0, 500));
        if (canRetry) res.retrying++;
        else res.failed++;
      }
    }
  } finally {
    transport.close();
  }
  if (res.sent && !res.paused) await updateSettings({ lastSmtpError: null });
  return res;
}

/** Manual resend from the admin UI, for failed / bounced / cancelled emails only. */
export async function requeueEmail(id: string): Promise<void> {
  const [e] = await db.select().from(t.emailMessages).where(eq(t.emailMessages.id, id));
  if (!e) throw new Error("Email not found.");
  if (e.kind === "test") throw new Error("Test emails can't be resent from the log. Use “Send test email”.");
  if (!["failed", "bounced", "cancelled"].includes(e.status)) throw new Error(`Only failed, bounced or cancelled emails can be resent (this one is ${e.status}).`);
  await setEmail(id, { status: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null, lockedAt: null, messageId: null, bouncedAt: null });
  await logEmailEvent(id, "queued", "Manually re-queued by administrator");
}

/** Records a delivery outcome from a bounce/DSN or a provider webhook. */
export async function recordDeliveryStatus(messageId: string, status: "delivered" | "bounced", detail?: string) {
  const [e] = await db.select().from(t.emailMessages).where(eq(t.emailMessages.messageId, messageId));
  if (!e) return null;
  if (e.status === "bounced" && status === "delivered") return e; // a bounce outranks a later "delivered"
  if (e.status === status) return e;
  await setEmail(
    e.id,
    status === "bounced" ? { status, bouncedAt: new Date(), lastError: detail?.slice(0, 500) ?? e.lastError } : { status, deliveredAt: new Date() },
  );
  await logEmailEvent(e.id, status, detail?.slice(0, 500));
  if (status === "bounced" && e.documentId) {
    await recordEvent(e.documentId, "email_bounced", { actor: "system", recipientId: e.recipientId, detail: `${e.kind} to ${e.toEmail} bounced` });
  }
  return e;
}
