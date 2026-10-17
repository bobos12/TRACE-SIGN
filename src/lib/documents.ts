// TRACE.SIGN signature workflow.
//
//   draft ──send──▶ sent ──(everyone signs)──▶ completed
//                    │ ├──(a signer declines)──▶ declined
//                    │ ├──(deadline passes)───▶ expired
//                    │ └──(sender cancels)────▶ voided
//
// Every state change is a conditional UPDATE (… WHERE status = <expected>), so double
// clicks, retries and overlapping workers can't run a transition twice. Every step is
// written to the hash-chained audit log (audit.ts). Documents, field images and finished
// files are encrypted at rest (crypto.sealBlob). Everything is scoped to a workspace (orgId).

import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "./db";
import type { Document, Field, Organization, Recipient } from "./schema";
import { env } from "./env";
import { openBlob, parseSigningToken, sealBlob, sha256Hex } from "./crypto";
import { getSettings } from "./settings";
import { enqueueEmail } from "./mail/outbox";
import { buildAuditTrailPdf, inspectPdf, renderFieldsIntoPdf, type RenderField } from "./pdf";
import { DATE_FORMATS, EMAIL_RE, FIELD_TYPES, normalizeRect, RECIPIENT_COLORS, type PageInfo } from "./geometry";
import { getOrg, sealIdentity } from "./org";
import { sealPdf } from "./seal";
import { listEvents, recordEvent, verifyAuditChain } from "./audit";
import { emitWebhook } from "./webhooks";
import { badRequest, conflict, forbidden, notFound } from "./errors";
import { PDFDocument } from "pdf-lib";

export { MAX_PDF_BYTES } from "./pdf";

/** Recipients who have been invited and can act. "pending" = not invited yet (sequential order). */
const INVITED = ["sent", "opened"];
const FINAL_DOC_STATES = ["completed", "declined", "expired", "voided"];

export interface Actor {
  label: string; // "sender:<email>", "recipient:<email>", "api:<prefix>", "system"
  ip?: string | null;
  userAgent?: string | null;
}
const SYSTEM: Actor = { label: "system" };

// ── Reads ───────────────────────────────────────────────────────────────

export async function getDocument(id: string, orgId: string): Promise<Document> {
  const [d] = await db.select().from(t.documents).where(and(eq(t.documents.id, id), eq(t.documents.orgId, orgId)));
  if (!d) throw notFound();
  return d;
}

export async function recipientsOf(documentId: string): Promise<Recipient[]> {
  return db.select().from(t.recipients).where(eq(t.recipients.documentId, documentId)).orderBy(asc(t.recipients.routingOrder), asc(t.recipients.createdAt));
}

export async function fieldsOf(documentId: string): Promise<Field[]> {
  return db.select().from(t.fields).where(eq(t.fields.documentId, documentId)).orderBy(asc(t.fields.page), asc(t.fields.y), asc(t.fields.x));
}

export function pagesOf(d: { pageInfo: string | null }): PageInfo[] {
  try {
    return d.pageInfo ? (JSON.parse(d.pageInfo) as PageInfo[]) : [];
  } catch {
    return [];
  }
}

/** Decrypted original PDF. */
export function originalPdf(d: Pick<Document, "fileData">): Buffer {
  return openBlob(d.fileData)!;
}

/** Fields stripped of the encrypted image, for JSON. */
export function publicField(f: Field) {
  return {
    id: f.id,
    recipientId: f.recipientId,
    type: f.type,
    page: f.page,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    required: f.required,
    label: f.label,
    placeholder: f.placeholder,
    defaultValue: f.defaultValue,
    options: f.options ? JSON.parse(f.options) : {},
    value: f.value,
    filledAt: f.filledAt,
  };
}

/**
 * Where the sender's own notifications go (opened, declined, completed, signed copy).
 * Documents sent by the built-in owner account or the API use the "Notification email"
 * from Email settings when it's set, so the login email doesn't have to be a real mailbox.
 * Team members' documents go to the member who sent them.
 */
async function notifyAddress(d: Document): Promise<string | null> {
  const s = await getSettings();
  const ownerOrApi = !d.createdBy || d.createdBy === "env" || d.createdBy.startsWith("api:");
  if (ownerOrApi && s.adminNotifyEmail) return s.adminNotifyEmail;
  return d.senderEmail || s.adminNotifyEmail || env.adminEmail() || null;
}

// ── Drafts ──────────────────────────────────────────────────────────────

export interface CreateDraftInput {
  orgId: string;
  createdBy: string;
  senderEmail: string;
  senderName: string;
  file: Buffer;
  fileName: string;
  title?: string;
  source?: "app" | "template" | "api";
  templateId?: string | null;
  externalRef?: string | null;
}

export async function createDraft(input: CreateDraftInput, actor: Actor): Promise<Document> {
  const info = await inspectPdf(input.file); // validates type, size, encryption, page count
  const title = (input.title?.trim() || input.fileName.replace(/\.pdf$/i, "").trim() || "Untitled document").slice(0, 200);
  const [doc] = await db
    .insert(t.documents)
    .values({
      orgId: input.orgId,
      createdBy: input.createdBy,
      senderEmail: input.senderEmail.toLowerCase(),
      senderName: input.senderName.slice(0, 100),
      title,
      fileName: input.fileName.slice(0, 200),
      fileData: sealBlob(input.file),
      fileSha256: sha256Hex(input.file),
      pageCount: info.pageCount,
      pageInfo: JSON.stringify(info.pages),
      status: "draft",
      source: input.source ?? "app",
      templateId: input.templateId ?? null,
      externalRef: input.externalRef ?? null,
    })
    .returning();
  await recordEvent(doc.id, "created", { actor: actor.label, ip: actor.ip, userAgent: actor.userAgent, detail: `${input.fileName} · ${info.pageCount} page(s) · SHA-256 ${doc.fileSha256}` });
  return doc;
}

const hexId = z.string().regex(/^[a-f0-9]{32}$/, "invalid id");
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const fieldOptionsInput = z
  .object({
    dateFormat: z.enum(DATE_FORMATS).optional(),
    fontSize: z.number().min(6).max(36).optional(),
    maxLength: z.number().int().min(1).max(2000).optional(),
  })
  .strict()
  .default({});

export const fieldInput = z.object({
  id: hexId,
  recipientId: hexId,
  type: z.enum(FIELD_TYPES as [string, ...string[]]),
  page: z.number().int().min(0),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
  required: z.boolean().default(true),
  label: z.string().trim().max(80).nullish(),
  placeholder: z.string().trim().max(120).nullish(),
  defaultValue: z.string().max(500).nullish(),
  options: fieldOptionsInput,
});

export const recipientInput = z.object({
  id: hexId,
  name: z.string().trim().max(120).default(""),
  email: z.string().trim().toLowerCase().max(254).default(""),
  roleLabel: z.string().trim().max(60).nullish(),
  color: hexColor.optional(),
  order: z.number().int().min(1).max(50).default(1),
});

export const draftInput = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().max(2000).nullish(),
  signingOrder: z.enum(["parallel", "sequential"]).default("parallel"),
  expiresInDays: z.number().int().min(0).max(365).default(30),
  reminderEveryDays: z.number().int().min(0).max(30).default(3),
  maxReminders: z.number().int().min(0).max(10).default(3),
  recipients: z.array(recipientInput).max(20),
  fields: z.array(fieldInput).max(1000),
});
export type DraftInput = z.infer<typeof draftInput>;

/** Checks that fields reference listed recipients and existing pages; clamps geometry onto the page. */
export function normalizeLayout(pages: PageInfo[], recipients: { id: string }[], fields: z.infer<typeof fieldInput>[]) {
  const ids = new Set(recipients.map((r) => r.id));
  const seen = new Set<string>();
  return fields.map((f) => {
    if (!ids.has(f.recipientId)) throw badRequest("A field is assigned to a recipient who isn't on this document.");
    const page = pages[f.page];
    if (!page) throw badRequest(`A field is on page ${f.page + 1}, but the document has ${pages.length} pages.`);
    if (seen.has(f.id)) throw badRequest("Duplicate field id.");
    seen.add(f.id);
    return { ...f, ...normalizeRect(f, page) };
  });
}

/**
 * Saves the editable state of a draft: details, recipients and the field layout.
 * Recipient and field ids are generated by the editor (random 128-bit), so the editor
 * can keep its selection across autosaves. Rows of other documents can never be touched:
 * deletes are scoped to this document and an id that exists elsewhere fails the insert.
 */
export async function saveDraft(id: string, orgId: string, input: DraftInput) {
  const doc = await getDocument(id, orgId);
  if (doc.status !== "draft") throw conflict("This document has been sent. Its fields and recipients are locked.");
  const fields = normalizeLayout(pagesOf(doc), input.recipients, input.fields);
  const existing = await recipientsOf(id);
  const existingIds = new Set(existing.map((r) => r.id));
  const keep = new Set(input.recipients.map((r) => r.id));

  await db.transaction(async (tx) => {
    await tx
      .update(t.documents)
      .set({
        title: input.title,
        message: input.message?.trim() || null,
        signingOrder: input.signingOrder,
        expiresInDays: input.expiresInDays,
        reminderEveryDays: input.reminderEveryDays,
        maxReminders: input.maxReminders,
        updatedAt: new Date(),
      })
      .where(and(eq(t.documents.id, id), eq(t.documents.status, "draft")));
    await tx.delete(t.fields).where(eq(t.fields.documentId, id));
    const gone = existing.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (gone.length) await tx.delete(t.recipients).where(and(eq(t.recipients.documentId, id), inArray(t.recipients.id, gone)));
    for (const [i, r] of input.recipients.entries()) {
      const row = {
        name: r.name,
        email: r.email,
        roleLabel: r.roleLabel || null,
        color: r.color ?? RECIPIENT_COLORS[i % RECIPIENT_COLORS.length],
        routingOrder: r.order,
      };
      if (existingIds.has(r.id)) await tx.update(t.recipients).set(row).where(and(eq(t.recipients.id, r.id), eq(t.recipients.documentId, id)));
      else await tx.insert(t.recipients).values({ id: r.id, documentId: id, status: "pending", ...row });
    }
    if (fields.length) {
      await tx.insert(t.fields).values(
        fields.map((f) => ({
          id: f.id,
          documentId: id,
          recipientId: f.recipientId,
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
          required: f.type === "date" ? true : f.required,
          label: f.label || null,
          placeholder: f.placeholder || null,
          defaultValue: f.defaultValue || null,
          options: Object.keys(f.options ?? {}).length ? JSON.stringify(f.options) : null,
        })),
      );
    }
  });
  return { ok: true, savedAt: new Date().toISOString() };
}

export interface SendProblem {
  recipientId?: string;
  message: string;
}

/** Everything that must be true before a document can go out. */
export function validateForSend(doc: Document, recs: Pick<Recipient, "id" | "name" | "email">[], fields: Pick<Field, "recipientId" | "type" | "page">[]): SendProblem[] {
  const problems: SendProblem[] = [];
  if (!doc.title.trim()) problems.push({ message: "Give the document a name." });
  if (!recs.length) problems.push({ message: "Add at least one recipient." });
  const emails = new Map<string, number>();
  for (const r of recs) {
    const who = r.name || r.email || "A recipient";
    if (!r.name.trim()) problems.push({ recipientId: r.id, message: `${who}: enter a name.` });
    if (!EMAIL_RE.test(r.email)) problems.push({ recipientId: r.id, message: `${who}: enter a valid email address.` });
    emails.set(r.email, (emails.get(r.email) ?? 0) + 1);
    const mine = fields.filter((f) => f.recipientId === r.id);
    if (!mine.some((f) => f.type === "signature" || f.type === "initials")) {
      problems.push({ recipientId: r.id, message: `${who} has no signature or initials field. Place one on the document.` });
    }
  }
  for (const [e, n] of emails) if (e && n > 1) problems.push({ message: `${e} is listed more than once.` });
  const pages = doc.pageCount ?? 0;
  if (fields.some((f) => f.page >= pages)) problems.push({ message: "A field is outside the document's pages." });
  return problems;
}

/** Sends a draft. Parallel: everyone at once. Sequential: routing group 1 first, the next group when it finishes. */
export async function sendDocument(id: string, orgId: string, actor: Actor): Promise<Document> {
  const doc = await getDocument(id, orgId);
  if (doc.status !== "draft") throw conflict(`This document is already ${doc.status}.`);
  const recs = await recipientsOf(id);
  const fields = await fieldsOf(id);
  const problems = validateForSend(doc, recs, fields);
  if (problems.length) {
    const e = badRequest(problems.map((p) => p.message).join(" "));
    (e as unknown as { problems: SendProblem[] }).problems = problems;
    throw e;
  }

  // Normalize routing: parallel → everyone 1; sequential → dense ranks 1..n keeping ties.
  const orders = [...new Set(recs.map((r) => r.routingOrder))].sort((a, b) => a - b);
  for (const r of recs) {
    const order = doc.signingOrder === "sequential" ? orders.indexOf(r.routingOrder) + 1 : 1;
    if (order !== r.routingOrder) await db.update(t.recipients).set({ routingOrder: order }).where(eq(t.recipients.id, r.id));
    r.routingOrder = order;
  }

  const now = new Date();
  const [sent] = await db
    .update(t.documents)
    .set({
      status: "sent",
      sentAt: now,
      expiresAt: doc.expiresInDays > 0 ? new Date(now.getTime() + doc.expiresInDays * 86400_000) : null,
      updatedAt: now,
    })
    .where(and(eq(t.documents.id, id), eq(t.documents.status, "draft")))
    .returning();
  if (!sent) throw conflict("This document was sent by another request.");
  await recordEvent(id, "sent", {
    actor: actor.label,
    ip: actor.ip,
    userAgent: actor.userAgent,
    detail: `${recs.length} recipient(s), ${fields.length} field(s), ${doc.signingOrder} signing`,
  });
  await emitWebhook(doc.orgId, "document.sent", id, { documentId: id, title: doc.title, externalRef: doc.externalRef, recipients: recs.map((r) => ({ id: r.id, name: r.name, email: r.email, order: r.routingOrder })) });
  await inviteNextGroup(sent);
  return sent;
}

/** Invites every not-yet-invited recipient in the lowest routing group that still has unsigned recipients. */
async function inviteNextGroup(doc: Document) {
  const recs = await recipientsOf(doc.id);
  const open = recs.filter((r) => r.status !== "signed");
  if (!open.length) return;
  const active = Math.min(...open.map((r) => r.routingOrder));
  const now = new Date();
  for (const r of open.filter((x) => x.routingOrder === active && x.status === "pending")) {
    const [inv] = await db
      .update(t.recipients)
      .set({ status: "sent", invitedAt: now })
      .where(and(eq(t.recipients.id, r.id), eq(t.recipients.status, "pending")))
      .returning();
    if (!inv) continue;
    await queueInvite(doc, inv);
    await recordEvent(doc.id, "invited", { actor: "system", recipientId: r.id, detail: `${r.name} <${r.email}>${doc.signingOrder === "sequential" ? ` · step ${active}` : ""}` });
  }
}

async function queueInvite(doc: Document, r: Recipient) {
  await enqueueEmail({
    idempotencyKey: `invite:${r.id}:v${r.tokenVersion}`,
    kind: "invite",
    toEmail: r.email,
    toName: r.name,
    documentId: doc.id,
    recipientId: r.id,
    payload: { documentTitle: doc.title, recipientName: r.name, senderName: doc.senderName, message: doc.message, expiresAt: doc.expiresAt?.toISOString() ?? null },
  });
}

export async function deleteDocument(id: string, orgId: string) {
  const doc = await getDocument(id, orgId);
  if (doc.status === "sent") throw conflict("Cancel (void) the signature request before deleting it.");
  await db.delete(t.documents).where(and(eq(t.documents.id, id), eq(t.documents.orgId, orgId)));
}

// ── Reminders / void ───────────────────────────────────────────────────

export async function sendReminder(recipientId: string, opts: { manual: boolean; orgId?: string; actor?: Actor }) {
  const row = await loadRecipient(recipientId);
  if (!row || (opts.orgId && row.d.orgId !== opts.orgId)) throw notFound("Recipient");
  const { r, d } = row;
  if (d.status !== "sent") throw conflict(`Document is ${d.status}.`);
  if (!INVITED.includes(r.status)) throw conflict(r.status === "pending" ? `${r.name} hasn't been invited yet (waiting for an earlier signer).` : `${r.name} already ${r.status}.`);
  if (opts.manual && r.lastReminderAt && Date.now() - r.lastReminderAt.getTime() < 3600_000) {
    throw conflict(`A reminder was sent to ${r.name} less than an hour ago.`);
  }
  // Atomic increment: concurrent callers get different numbers, so each reminder key is unique.
  const [u] = await db
    .update(t.recipients)
    .set({ reminderCount: sql`${t.recipients.reminderCount} + 1`, lastReminderAt: new Date() })
    .where(eq(t.recipients.id, r.id))
    .returning({ n: t.recipients.reminderCount });
  await enqueueEmail({
    idempotencyKey: `reminder:${r.id}:v${r.tokenVersion}:${u.n}`,
    kind: "reminder",
    toEmail: r.email,
    toName: r.name,
    documentId: d.id,
    recipientId: r.id,
    payload: { documentTitle: d.title, recipientName: r.name, senderName: d.senderName, expiresAt: d.expiresAt?.toISOString() ?? null, reminderNumber: u.n },
  });
  await recordEvent(d.id, "reminder", { actor: opts.actor?.label ?? "system", recipientId: r.id, detail: `${opts.manual ? "Manual" : "Automatic"} reminder #${u.n} to ${r.email}` });
}

/** Re-sends to everyone currently waiting to sign. */
export async function remindAll(documentId: string, orgId: string, actor: Actor) {
  const d = await getDocument(documentId, orgId);
  if (d.status !== "sent") throw conflict(`Document is ${d.status}.`);
  const waiting = (await recipientsOf(documentId)).filter((r) => INVITED.includes(r.status));
  const errors: string[] = [];
  let sent = 0;
  for (const r of waiting) {
    try {
      await sendReminder(r.id, { manual: true, orgId, actor });
      sent++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (!sent && errors.length) throw conflict(errors.join(" "));
  return { sent, skipped: errors };
}

export async function voidDocument(documentId: string, orgId: string, reason: string, actor: Actor) {
  const doc = await getDocument(documentId, orgId);
  const [won] = await db
    .update(t.documents)
    .set({ status: "voided", updatedAt: new Date() })
    .where(and(eq(t.documents.id, doc.id), eq(t.documents.status, "sent")))
    .returning();
  if (!won) throw conflict("Only documents that are out for signature can be cancelled.");
  // Revoke every outstanding signing link.
  await db.update(t.recipients).set({ tokenVersion: sql`${t.recipients.tokenVersion} + 1` }).where(eq(t.recipients.documentId, documentId));
  await recordEvent(documentId, "voided", { actor: actor.label, ip: actor.ip, userAgent: actor.userAgent, detail: reason || null });
  await emitWebhook(doc.orgId, "document.voided", documentId, { documentId, title: doc.title, externalRef: doc.externalRef, reason: reason || null });
  for (const r of (await recipientsOf(documentId)).filter((x) => INVITED.includes(x.status))) {
    await enqueueEmail({
      idempotencyKey: `cancelled:${r.id}`,
      kind: "cancelled",
      toEmail: r.email,
      toName: r.name,
      documentId,
      recipientId: r.id,
      payload: { documentTitle: won.title, recipientName: r.name },
    });
  }
}

// ── Signing ────────────────────────────────────────────────────────────

async function loadRecipient(recipientId: string) {
  const [row] = await db
    .select({ r: t.recipients, d: t.documents })
    .from(t.recipients)
    .innerJoin(t.documents, eq(t.recipients.documentId, t.documents.id))
    .where(eq(t.recipients.id, recipientId));
  return row ?? null;
}

export interface SigningSession {
  recipient: Recipient;
  document: Document;
  linkExpired: boolean;
}

/** Resolves a signing link. Returns null for forged, revoked or unknown links. */
export async function resolveToken(token: string): Promise<SigningSession | null> {
  const parsed = parseSigningToken(token);
  if (!parsed) return null;
  const row = await loadRecipient(parsed.recipientId);
  if (!row || row.r.tokenVersion !== parsed.version) return null;
  return { recipient: row.r, document: row.d, linkExpired: parsed.expired };
}

export type SignState = "open" | "waiting" | "signed" | "completed" | "declined" | "expired" | "voided" | "link_expired";

export function signState(s: SigningSession): SignState {
  const { recipient: r, document: d } = s;
  if (d.status === "voided") return "voided";
  if (d.status === "completed") return s.linkExpired ? "link_expired" : "completed";
  if (s.linkExpired) return "link_expired";
  if (d.status === "expired" || (d.status === "sent" && d.expiresAt && d.expiresAt < new Date())) return "expired";
  if (r.status === "declined" || d.status === "declined") return "declined";
  if (r.status === "signed") return "signed";
  if (r.status === "pending") return "waiting";
  return "open";
}

/** A session that may sign right now; anything else throws a user-facing error. */
async function openSession(token: string): Promise<SigningSession> {
  const s = await resolveToken(token);
  if (!s) throw forbidden("This signing link is not valid.");
  const state = signState(s);
  const msg: Partial<Record<SignState, string>> = {
    link_expired: "This signing link has expired. Ask the sender for a new one.",
    voided: "The sender cancelled this signature request.",
    expired: "This signature request has expired.",
    declined: "This signature request was declined and is closed.",
    signed: "You have already signed this document.",
    completed: "This document is already completed.",
    waiting: "It isn't your turn to sign yet. You'll get an email when it is.",
  };
  if (state !== "open") throw conflict(msg[state] ?? "This document can't be signed.");
  return s;
}

export async function markOpened(s: SigningSession, actor: Actor) {
  const { recipient, document } = s;
  if (recipient.openedAt || document.status !== "sent" || recipient.status !== "sent") return;
  const won = await db
    .update(t.recipients)
    .set({ openedAt: new Date(), status: "opened" })
    .where(and(eq(t.recipients.id, recipient.id), eq(t.recipients.status, "sent")))
    .returning({ id: t.recipients.id });
  if (won.length !== 1) return; // a parallel request recorded it first
  await recordEvent(document.id, "viewed", { actor: `recipient:${recipient.email}`, recipientId: recipient.id, ip: actor.ip, userAgent: actor.userAgent, detail: `${recipient.name} opened the document` });
  await emitWebhook(document.orgId, "recipient.viewed", recipient.id, { documentId: document.id, externalRef: document.externalRef, recipient: { id: recipient.id, name: recipient.name, email: recipient.email } });
  const s2 = await getSettings();
  const to = await notifyAddress(document);
  if (s2.notifyOnOpen && to) {
    await enqueueEmail({
      idempotencyKey: `opened:${recipient.id}`,
      kind: "opened",
      toEmail: to,
      documentId: document.id,
      payload: { documentTitle: document.title, recipientName: recipient.name, recipientEmail: recipient.email, openedAt: new Date().toISOString() },
    });
  }
}

export async function recordConsent(token: string, actor: Actor) {
  const s = await openSession(token);
  if (s.recipient.consentAt) return { consentAt: s.recipient.consentAt };
  const now = new Date();
  await db.update(t.recipients).set({ consentAt: now }).where(and(eq(t.recipients.id, s.recipient.id), sql`${t.recipients.consentAt} is null`));
  await recordEvent(s.document.id, "consent", {
    actor: `recipient:${s.recipient.email}`,
    recipientId: s.recipient.id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    detail: "Agreed to use electronic records and signatures (ESIGN consumer disclosure v1)",
  });
  return { consentAt: now };
}

const pngData = z.string().max(1_400_000);
export const signInput = z.object({
  consent: z.literal(true),
  values: z.record(z.string(), z.string().max(2000)).default({}),
  signature: z.object({ method: z.enum(["typed", "drawn", "uploaded"]), png: pngData, text: z.string().max(120).optional() }).optional(),
  initials: z.object({ method: z.enum(["typed", "drawn", "uploaded"]), png: pngData, text: z.string().max(20).optional() }).optional(),
});
export type SignInput = z.infer<typeof signInput>;

/** Decodes a PNG data URL and checks it really is a reasonably sized PNG. */
export function decodePng(dataUrl: string): Buffer {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 60 || buf.length > 1_000_000) throw badRequest("The signature image is empty or too large.");
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw badRequest("The signature must be a PNG image.");
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (!w || !h || w > 4000 || h > 4000) throw badRequest("The signature image has invalid dimensions.");
  return buf;
}

/**
 * Applies a signer's values to THEIR fields only, and marks them signed — atomically.
 * Values for fields that belong to someone else are rejected. Date-signed fields are
 * set by the server to the actual signing instant (UTC).
 */
export async function completeSigning(token: string, input: SignInput, actor: Actor) {
  const s = await openSession(token);
  const { recipient: r, document: d } = s;
  const mine = (await fieldsOf(d.id)).filter((f) => f.recipientId === r.id);
  const mineIds = new Set(mine.map((f) => f.id));
  for (const k of Object.keys(input.values)) if (!mineIds.has(k)) throw forbidden("You can only complete fields assigned to you.");

  const sigPng = input.signature ? decodePng(input.signature.png) : null;
  const iniPng = input.initials ? decodePng(input.initials.png) : null;
  const now = new Date();
  const updates: { id: string; value: string | null; image: Buffer | null }[] = [];
  const missing: string[] = [];

  for (const f of mine) {
    const v = input.values[f.id];
    const label = f.label || f.type;
    switch (f.type) {
      case "signature":
      case "initials": {
        const img = f.type === "signature" ? sigPng : iniPng;
        const wants = f.required || v === "signed";
        if (!wants) break;
        if (!img) {
          missing.push(f.type === "signature" ? "signature" : "initials");
          break;
        }
        updates.push({ id: f.id, value: "signed", image: img });
        break;
      }
      case "date":
        updates.push({ id: f.id, value: now.toISOString(), image: null });
        break;
      case "checkbox": {
        const on = v === "true";
        if (f.required && !on) missing.push(label);
        updates.push({ id: f.id, value: on ? "true" : "false", image: null });
        break;
      }
      case "email": {
        const val = (v ?? f.defaultValue ?? r.email).trim();
        if (!val) {
          if (f.required) missing.push(label);
          break;
        }
        if (!EMAIL_RE.test(val)) throw badRequest(`“${val}” is not a valid email address.`);
        updates.push({ id: f.id, value: val.slice(0, 254), image: null });
        break;
      }
      default: {
        const fallback = f.type === "name" ? r.name : (f.defaultValue ?? "");
        const val = (v ?? fallback).trim();
        const max = (f.options ? (JSON.parse(f.options) as { maxLength?: number }).maxLength : undefined) ?? (f.type === "name" ? 120 : 500);
        if (!val) {
          if (f.required) missing.push(label);
          break;
        }
        if (val.length > max) throw badRequest(`${label} can be at most ${max} characters.`);
        updates.push({ id: f.id, value: val, image: null });
      }
    }
  }
  // Documents without placed fields (created before v2) still require an adopted signature.
  if (!mine.some((f) => f.type === "signature" || f.type === "initials") && !sigPng) missing.push("signature");
  if (missing.length) throw badRequest(`Complete the required fields first: ${[...new Set(missing)].join(", ")}.`);

  const method = input.signature?.method ?? input.initials?.method ?? null;
  await db.transaction(async (tx) => {
    const won = await tx
      .update(t.recipients)
      .set({
        status: "signed",
        signedAt: now,
        consentAt: r.consentAt ?? now,
        openedAt: r.openedAt ?? now,
        signatureMethod: method,
        signatureText: input.signature?.text?.trim() || r.name,
        signaturePng: sigPng ? sealBlob(sigPng) : iniPng ? sealBlob(iniPng) : null,
        signerIp: actor.ip?.slice(0, 64) ?? null,
        signerAgent: actor.userAgent?.slice(0, 300) ?? null,
      })
      .where(and(eq(t.recipients.id, r.id), inArray(t.recipients.status, INVITED)))
      .returning({ id: t.recipients.id });
    if (won.length !== 1) throw conflict("You have already responded to this request.");
    for (const u of updates) {
      await tx
        .update(t.fields)
        .set({ value: u.value, valueImage: u.image ? sealBlob(u.image) : null, filledAt: now })
        .where(and(eq(t.fields.id, u.id), eq(t.fields.recipientId, r.id), eq(t.fields.documentId, d.id)));
    }
  });

  if (!r.consentAt) {
    await recordEvent(d.id, "consent", { actor: `recipient:${r.email}`, recipientId: r.id, ip: actor.ip, userAgent: actor.userAgent, detail: "Agreed to use electronic records and signatures" });
  }
  await recordEvent(d.id, "signed", {
    actor: `recipient:${r.email}`,
    recipientId: r.id,
    ip: actor.ip,
    userAgent: actor.userAgent,
    detail: `${r.name} signed · ${updates.length} field(s) · ${method ?? "signature"} signature`,
  });
  await emitWebhook(d.orgId, "recipient.signed", r.id, { documentId: d.id, externalRef: d.externalRef, recipient: { id: r.id, name: r.name, email: r.email }, signedAt: now.toISOString() });
  await advance(d.id);
}

export async function declineAsRecipient(token: string, reason: string, actor: Actor) {
  const { recipient: r, document: d } = await openSession(token);
  const why = reason.trim().slice(0, 1000);
  const won = await db
    .update(t.recipients)
    .set({ status: "declined", declinedAt: new Date(), declineReason: why || null, signerIp: actor.ip?.slice(0, 64) ?? null, signerAgent: actor.userAgent?.slice(0, 300) ?? null })
    .where(and(eq(t.recipients.id, r.id), inArray(t.recipients.status, INVITED)))
    .returning({ id: t.recipients.id });
  if (won.length !== 1) throw conflict("You have already responded to this request.");
  await db.update(t.documents).set({ status: "declined", updatedAt: new Date() }).where(and(eq(t.documents.id, d.id), eq(t.documents.status, "sent")));
  await recordEvent(d.id, "declined", { actor: `recipient:${r.email}`, recipientId: r.id, ip: actor.ip, userAgent: actor.userAgent, detail: `${r.name}${why ? `: ${why.slice(0, 300)}` : ""}` });
  await emitWebhook(d.orgId, "recipient.declined", r.id, { documentId: d.id, externalRef: d.externalRef, recipient: { id: r.id, name: r.name, email: r.email }, reason: why || null });
  await emitWebhook(d.orgId, "document.declined", d.id, { documentId: d.id, title: d.title, externalRef: d.externalRef, declinedBy: r.email });

  const s = await getSettings();
  const to = await notifyAddress(d);
  if (s.notifyOnDecline && to) {
    await enqueueEmail({
      idempotencyKey: `declined:${d.id}`,
      kind: "declined",
      toEmail: to,
      documentId: d.id,
      payload: { documentTitle: d.title, recipientName: r.name, recipientEmail: r.email, reason: why || null },
    });
  }
  for (const other of await recipientsOf(d.id)) {
    if (other.id === r.id || !["sent", "opened", "signed"].includes(other.status)) continue;
    await enqueueEmail({
      idempotencyKey: `cancelled:${other.id}`,
      kind: "cancelled",
      toEmail: other.email,
      toName: other.name,
      documentId: d.id,
      recipientId: other.id,
      payload: { documentTitle: d.title, recipientName: other.name, declinedBy: r.name },
    });
  }
}

/** After a signature: invite the next routing group, or complete when everyone has signed. */
async function advance(documentId: string) {
  const [doc] = await db.select().from(t.documents).where(eq(t.documents.id, documentId));
  if (!doc || doc.status !== "sent") return;
  const recs = await recipientsOf(documentId);
  if (recs.length && recs.every((r) => r.status === "signed")) return completeDocument(documentId);
  await inviteNextGroup(doc);
}

// ── Completion ─────────────────────────────────────────────────────────

/** Runs once per document, guarded by a conditional status update. */
export async function completeDocument(documentId: string) {
  const won = await db
    .update(t.documents)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(t.documents.id, documentId), eq(t.documents.status, "sent")))
    .returning();
  if (won.length !== 1) return;
  await recordEvent(documentId, "completed", { actor: "system", detail: "All recipients signed; workflow locked" });
  await finishCompletedDocument(documentId);
}

/** Field rows ready for the PDF writer (images decrypted). */
async function renderableFields(documentId: string, filter?: (f: Field) => boolean): Promise<RenderField[]> {
  return (await fieldsOf(documentId))
    .filter((f) => (filter ? filter(f) : true))
    .filter((f) => f.filledAt)
    .map((f) => ({ type: f.type as RenderField["type"], page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, value: f.value, image: openBlob(f.valueImage), options: f.options, filledAt: f.filledAt }));
}

/**
 * The document as a signer sees it while signing: the original pages with the values that
 * EARLIER signers have already completed written in. Never includes another signer's open fields.
 */
export async function inProgressPdf(d: Document): Promise<Buffer> {
  const org = await getOrg(d.orgId);
  const filled = await renderableFields(d.id);
  const original = originalPdf(d);
  if (!filled.length) return original;
  return renderFieldsIntoPdf(original, filled, { timeZone: org.timezone, dateFormat: org.dateFormat });
}

async function buildArtifacts(doc: Document, org: Organization) {
  const original = originalPdf(doc);
  const ctx = { timeZone: org.timezone, dateFormat: org.dateFormat };
  const flattened = await renderFieldsIntoPdf(original, await renderableFields(doc.id), ctx);

  let final = flattened;
  let sealed = false;
  if (org.sealPdf) {
    try {
      final = await sealPdf(flattened, await sealIdentity(org), { reason: `Signed electronically via ${org.brandName}`, name: `${org.brandName} Document Seal`, contact: (await getSettings()).fromEmail });
      sealed = true;
    } catch (e) {
      await recordEvent(doc.id, "seal_failed", { actor: "system", detail: (e as Error).message.slice(0, 300) });
    }
  }
  // Hard guarantee: the signed document has exactly the original page count.
  const pages = (await PDFDocument.load(final, { updateMetadata: false })).getPageCount();
  if (pages !== (doc.pageCount ?? pages)) throw new Error(`Page count changed (${doc.pageCount} → ${pages}); finalization aborted.`);

  const completedSha256 = sha256Hex(final);
  await recordEvent(doc.id, "pdf_ready", { actor: "system", detail: `Signed PDF: ${pages} page(s), SHA-256 ${completedSha256}${sealed ? ", digitally sealed (PKCS#7)" : ""}` });

  const recs = await recipientsOf(doc.id);
  const allFields = await fieldsOf(doc.id);
  const events = await listEvents(doc.id);
  const chain = await verifyAuditChain(doc.id);
  const audit = await buildAuditTrailPdf({
    brandName: org.brandName,
    documentTitle: doc.title,
    documentId: doc.id,
    fileName: doc.fileName,
    pageCount: pages,
    originalSha256: doc.fileSha256,
    completedSha256,
    sentAt: doc.sentAt,
    completedAt: doc.completedAt,
    status: doc.status,
    signingOrder: doc.signingOrder,
    sealed,
    timeZone: org.timezone,
    signers: recs.map((r) => ({
      name: r.name,
      email: r.email,
      role: r.roleLabel,
      order: r.routingOrder,
      status: r.status,
      invitedAt: r.invitedAt,
      openedAt: r.openedAt,
      consentAt: r.consentAt,
      signedAt: r.signedAt,
      declinedAt: r.declinedAt,
      ip: r.signerIp,
      agent: r.signerAgent,
      method: r.signatureMethod,
      signatureImage: openBlob(r.signaturePng),
      fieldsCompleted: allFields.filter((f) => f.recipientId === r.id && f.filledAt).length,
    })),
    events: events.map((e) => ({ seq: e.seq, at: e.createdAt, type: e.type, actor: e.actor, detail: e.detail, ip: e.ip })),
    chain,
  });
  await db
    .update(t.documents)
    .set({ completedPdf: sealBlob(final), completedSha256, auditPdf: sealBlob(audit), auditSha256: sha256Hex(audit), sealed, updatedAt: new Date() })
    .where(eq(t.documents.id, doc.id));
  return { completedSha256, sealed, pages };
}

/** Builds the signed PDF + audit trail, then queues completion emails. Safe to re-run (idempotent keys). */
export async function finishCompletedDocument(documentId: string) {
  const [doc] = await db.select().from(t.documents).where(eq(t.documents.id, documentId));
  if (!doc || doc.status !== "completed") throw conflict("Document is not completed.");
  const org = await getOrg(doc.orgId);
  const recs = await recipientsOf(documentId);
  const s = await getSettings();
  const to = await notifyAddress(doc);

  if (!doc.completedPdf) {
    try {
      await buildArtifacts(doc, org);
    } catch (e) {
      await recordEvent(documentId, "pdf_failed", { actor: "system", detail: (e as Error).message.slice(0, 300) });
      return; // completion emails wait until a PDF exists; the sender can retry from the document page
    }
  }
  await emitWebhook(doc.orgId, "document.completed", documentId, {
    documentId,
    title: doc.title,
    externalRef: doc.externalRef,
    completedAt: doc.completedAt?.toISOString(),
    recipients: recs.map((r) => ({ id: r.id, name: r.name, email: r.email, signedAt: r.signedAt?.toISOString() })),
  });

  const signers = recs.map((r) => ({ name: r.name, email: r.email, signedAt: r.signedAt?.toISOString() ?? "" }));
  if (s.notifyOnComplete && to) {
    await enqueueEmail({ idempotencyKey: `completed:${documentId}`, kind: "completed", toEmail: to, documentId, payload: { documentTitle: doc.title, signers } });
  }
  for (const r of recs) {
    await enqueueEmail({
      idempotencyKey: `completed_pdf:${documentId}:${r.id}`,
      kind: "completed_pdf",
      toEmail: r.email,
      toName: r.name,
      documentId,
      recipientId: r.id,
      payload: { documentTitle: doc.title, recipientName: r.name },
    });
  }
  if (to && !recs.some((r) => r.email === to.toLowerCase())) {
    await enqueueEmail({
      idempotencyKey: `completed_pdf:${documentId}:sender`,
      kind: "completed_pdf",
      toEmail: to,
      documentId,
      payload: { documentTitle: doc.title, recipientName: doc.senderName, audience: "admin" },
    });
  }
}

// ── Scheduler jobs ─────────────────────────────────────────────────────

/** Expires overdue requests and notifies waiting recipients and the sender. */
export async function expireDueDocuments(): Promise<number> {
  const due = await db.select().from(t.documents).where(and(eq(t.documents.status, "sent"), lt(t.documents.expiresAt, new Date())));
  if (!due.length) return 0;
  const s = await getSettings();
  let n = 0;
  for (const doc of due) {
    const won = await db
      .update(t.documents)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(t.documents.id, doc.id), eq(t.documents.status, "sent")))
      .returning({ id: t.documents.id });
    if (won.length !== 1) continue;
    n++;
    await recordEvent(doc.id, "expired", { actor: "system" });
    await emitWebhook(doc.orgId, "document.expired", doc.id, { documentId: doc.id, title: doc.title, externalRef: doc.externalRef });
    const recs = await recipientsOf(doc.id);
    for (const r of recs.filter((x) => INVITED.includes(x.status))) {
      await enqueueEmail({
        idempotencyKey: `expired:${doc.id}:${r.id}`,
        kind: "expired",
        toEmail: r.email,
        toName: r.name,
        documentId: doc.id,
        recipientId: r.id,
        payload: { documentTitle: doc.title, recipientName: r.name, audience: "recipient" },
      });
    }
    const to = await notifyAddress(doc);
    if (s.notifyOnExpire && to) {
      await enqueueEmail({
        idempotencyKey: `expired:${doc.id}:admin`,
        kind: "expired",
        toEmail: to,
        documentId: doc.id,
        payload: { documentTitle: doc.title, audience: "admin", signers: recs.map((r) => ({ name: r.name, email: r.email, signedAt: r.signedAt?.toISOString() ?? "" })) },
      });
    }
  }
  return n;
}

/** Queues automatic reminders according to each document's schedule. */
export async function sendDueReminders(): Promise<number> {
  const rows = await db
    .select({ r: t.recipients, d: t.documents })
    .from(t.recipients)
    .innerJoin(t.documents, eq(t.recipients.documentId, t.documents.id))
    .where(and(inArray(t.recipients.status, INVITED), eq(t.documents.status, "sent"), sql`${t.documents.reminderEveryDays} > 0`));
  let n = 0;
  const now = Date.now();
  for (const { r, d } of rows) {
    if (r.reminderCount >= d.maxReminders) continue;
    if (d.expiresAt && d.expiresAt.getTime() < now) continue;
    const last = (r.lastReminderAt ?? r.invitedAt ?? r.createdAt).getTime();
    if (now - last < d.reminderEveryDays * 86400_000) continue;
    try {
      await sendReminder(r.id, { manual: false });
      n++;
    } catch {
      /* state changed meanwhile */
    }
  }
  return n;
}

/** Data retention: deletes finished documents older than each workspace's retention period. */
export async function purgeExpiredData(): Promise<number> {
  const orgs = await db.select({ id: t.organizations.id, days: t.organizations.retentionDays }).from(t.organizations);
  let n = 0;
  for (const o of orgs) {
    if (!o.days) continue;
    const cutoff = new Date(Date.now() - o.days * 86400_000);
    const gone = await db
      .delete(t.documents)
      .where(and(eq(t.documents.orgId, o.id), inArray(t.documents.status, FINAL_DOC_STATES), lt(t.documents.updatedAt, cutoff)))
      .returning({ id: t.documents.id });
    n += gone.length;
  }
  return n;
}
