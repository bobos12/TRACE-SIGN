import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { and, eq } from "drizzle-orm";
import { db, t } from "../db";
import type { EmailSettings } from "../schema";
import { sha256Hex } from "../crypto";
import { getSettings, imapCredentials, updateSettings } from "../settings";
import { withLock } from "../locks";
import { parseOutboxIdFromMessageId } from "./transport";
import { recordDeliveryStatus } from "./outbox";

const REL = { id: t.emailMessages.id, documentId: t.emailMessages.documentId, messageId: t.emailMessages.messageId };
const MAX_STORED_SOURCE = 20 * 1024 * 1024; // 20 MB
const BATCH = 200;

function client(s: EmailSettings): ImapFlow {
  if (!s.imapHost || !s.imapPort) throw new Error("IMAP server hostname and port are not configured.");
  const creds = imapCredentials(s);
  if (!creds) {
    throw new Error(s.imapUseSmtpLogin ? "IMAP uses the SMTP login, but the SMTP username/password is not set." : "IMAP username/password is not set.");
  }
  return new ImapFlow({
    host: s.imapHost,
    port: s.imapPort,
    secure: s.imapSecure,
    auth: creds,
    tls: { minVersion: "TLSv1.2", servername: s.imapHost },
    logger: false, // protocol logs would include the LOGIN command
    emitLogs: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
    disableAutoIdle: true,
  });
}

function imapError(err: unknown, pass?: string): string {
  const e = err as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
  let msg = e?.authenticationFailed
    ? "IMAP login failed. Use the parent mailbox's full address and password (aliases normally have no IMAP login)."
    : `${e?.responseText || e?.message || String(err)}${e?.code ? ` (${e.code})` : ""}`;
  if (pass) msg = msg.split(pass).join("•••");
  return msg.slice(0, 500);
}

export async function testImapConnection(): Promise<{ ok: boolean; message: string; mailboxes?: string[]; messages?: number }> {
  const s = await getSettings();
  let c: ImapFlow | null = null;
  try {
    c = client(s);
    await c.connect();
    const list = await c.list();
    const box = await c.mailboxOpen(s.imapMailbox, { readOnly: true });
    await updateSettings({ imapLastError: null });
    return {
      ok: true,
      message: `Connected to ${s.imapHost} and opened “${s.imapMailbox}” read-only (${box.exists} messages). Nothing was changed in the mailbox.`,
      mailboxes: list.map((m) => m.path),
      messages: box.exists,
    };
  } catch (err) {
    const msg = imapError(err, imapCredentials(s)?.pass);
    await updateSettings({ imapLastError: msg }).catch(() => undefined);
    return { ok: false, message: msg };
  } finally {
    await c?.logout().catch(() => undefined);
  }
}

// ── Header helpers ──────────────────────────────────────────────────────────

function parseHeaderBlock(buf?: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  if (!buf) return out;
  const unfolded = buf.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase();
      out.set(k, out.has(k) ? `${out.get(k)}, ${line.slice(i + 1).trim()}` : line.slice(i + 1).trim());
    }
  }
  return out;
}

function addresses(v?: string): string[] {
  return (v?.match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((a) => a.toLowerCase());
}

function msgIds(v?: string | string[] | null): string[] {
  const s = Array.isArray(v) ? v.join(" ") : v ?? "";
  return s.match(/<[^<>\s]+>/g) ?? [];
}

function addrList(a?: AddressObject | AddressObject[]): string {
  const arr = Array.isArray(a) ? a : a ? [a] : [];
  return arr.flatMap((x) => x.value.map((v) => v.address ?? "")).filter(Boolean).join(", ");
}

// ── Sync ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  scanned: number;
  imported: number;
  duplicates: number;
  bounces: number;
  matched: number;
  error?: string;
}

/**
 * Imports signature-related messages from the connected mailbox.
 * - Opens the mailbox read-only (EXAMINE) unless the admin turned that off; fetches use
 *   BODY.PEEK so \Seen is never set. Nothing is moved or deleted.
 * - Only messages addressed to the TRACE.SIGN alias, replying to a TRACE.SIGN email,
 *   or bouncing one are imported. Everything else in the parent mailbox is ignored.
 * - Deduplicated by Message-ID (or content hash) and by (UIDVALIDITY, UID).
 */
export async function syncMailbox(): Promise<SyncResult | { skipped: true }> {
  return withLock("imap", 10 * 60_000, syncLocked);
}

async function syncLocked(): Promise<SyncResult> {
  const res: SyncResult = { scanned: 0, imported: 0, duplicates: 0, bounces: 0, matched: 0 };
  const s = await getSettings();
  if (!s.imapEnabled) return { ...res, error: "IMAP integration is disabled." };

  let c: ImapFlow | null = null;
  try {
    c = client(s);
    await c.connect();
    const lock = await c.getMailboxLock(s.imapMailbox, { readOnly: s.imapReadOnly });
    try {
      const box = c.mailbox;
      if (!box) throw new Error("Mailbox did not open.");
      const uidValidity = box.uidValidity.toString();
      let lastUid = s.imapUidValidity === uidValidity ? s.imapLastUid : 0;

      let uids: number[];
      if (lastUid === 0) {
        const since = new Date(Date.now() - s.imapInitialLookbackDays * 86400_000);
        uids = ((await c.search({ since }, { uid: true })) || []) as number[];
      } else {
        uids = ((await c.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []) as number[];
      }
      uids = uids.filter((u) => u > lastUid).sort((a, b) => a - b);

      const alias = s.fromEmail.toLowerCase();
      const ourDomain = alias.split("@")[1];

      for (let i = 0; i < uids.length; i += BATCH) {
        const chunk = uids.slice(i, i + BATCH);
        const heads = await c.fetchAll(
          chunk,
          {
            uid: true,
            envelope: true,
            headers: ["to", "cc", "delivered-to", "x-original-to", "envelope-to", "in-reply-to", "references", "content-type", "from", "return-path"],
          },
          { uid: true },
        );

        for (const h of heads) {
          res.scanned++;
          const hdr = parseHeaderBlock(h.headers);
          const rcpts = [hdr.get("to"), hdr.get("cc"), hdr.get("delivered-to"), hdr.get("x-original-to"), hdr.get("envelope-to")].flatMap((v) => addresses(v));
          const threadIds = [...msgIds(hdr.get("in-reply-to")), ...msgIds(hdr.get("references"))];
          const repliesToUs = threadIds.some((m) => parseOutboxIdFromMessageId(m) && m.toLowerCase().endsWith(`@${ourDomain}>`));
          const from = (hdr.get("from") || "").toLowerCase();
          const ctype = (hdr.get("content-type") || "").toLowerCase();
          const looksLikeBounce = ctype.includes("multipart/report") || /mailer-daemon|postmaster/.test(from) || hdr.get("return-path") === "<>";
          const fromSelf = addresses(from).includes(alias);

          const relevant = !fromSelf && (rcpts.includes(alias) || repliesToUs || looksLikeBounce);
          if (relevant) {
            const r = await importOne(c, h.uid, s.imapMailbox, uidValidity, ourDomain);
            // Only when the admin turned read-only off: tag (never move/delete) imported messages.
            if (r && r !== "duplicate" && !s.imapReadOnly) await c.messageFlagsAdd(String(h.uid), ["$TraceSignImported"], { uid: true }).catch(() => undefined);
            if (r === "duplicate") res.duplicates++;
            else if (r) {
              res.imported++;
              if (r.kind === "bounce") res.bounces++;
              if (r.documentId) res.matched++;
            }
          }
          lastUid = Math.max(lastUid, h.uid);
        }
        await updateSettings({ imapUidValidity: uidValidity, imapLastUid: lastUid });
      }
      await updateSettings({ imapUidValidity: uidValidity, imapLastUid: lastUid, imapLastSyncAt: new Date(), imapLastError: null });
    } finally {
      lock.release();
    }
  } catch (err) {
    res.error = imapError(err, imapCredentials(s)?.pass);
    await updateSettings({ imapLastError: res.error, imapLastSyncAt: new Date() }).catch(() => undefined);
  } finally {
    await c?.logout().catch(() => undefined);
  }
  return res;
}

async function importOne(
  c: ImapFlow,
  uid: number,
  mailbox: string,
  uidValidity: string,
  ourDomain: string,
): Promise<{ kind: string; documentId: string | null } | "duplicate" | null> {
  const [already] = await db
    .select({ id: t.inboundEmails.id })
    .from(t.inboundEmails)
    .where(and(eq(t.inboundEmails.mailbox, mailbox), eq(t.inboundEmails.uidValidity, uidValidity), eq(t.inboundEmails.uid, uid)));
  if (already) return "duplicate";

  const msg = await c.fetchOne(String(uid), { uid: true, source: true, internalDate: true }, { uid: true });
  if (!msg || !msg.source) return null;
  const source = msg.source;
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const messageId = parsed.messageId || `sha256:${sha256Hex(source)}`;

  const raw = source.toString("utf8");
  const ctype = String(parsed.headers.get("content-type") ? (parsed.headers.get("content-type") as { value?: string }).value ?? "" : "").toLowerCase();
  const autoSubmitted = String(parsed.headers.get("auto-submitted") ?? "no").toLowerCase();
  const fromAddr = parsed.from?.value[0]?.address?.toLowerCase() ?? null;
  const subject = parsed.subject ?? "";

  const isBounce = ctype.includes("multipart/report") || /mailer-daemon|postmaster/.test(fromAddr ?? "") || /^(undeliverable|delivery status notification|mail delivery failed|returned mail)/i.test(subject);
  const isAuto = !isBounce && (autoSubmitted !== "no" || /^(automatic reply|auto(-|matic )?reply|out of (the )?office)/i.test(subject));
  const kind = isBounce ? "bounce" : isAuto ? "auto_reply" : "reply";

  // Associate with a TRACE.SIGN email: first by threading headers, then (bounces) by
  // our Message-ID / X-TraceSign-Email-Id quoted inside the returned original message.
  const threadIds = [...msgIds(parsed.inReplyTo), ...msgIds(parsed.references)];
  let related = null as null | { id: string; documentId: string | null; messageId: string | null };
  let matchedBy: string | null = null;
  for (const mid of threadIds.reverse()) {
    const [e] = await db.select(REL).from(t.emailMessages).where(eq(t.emailMessages.messageId, mid));
    if (e) {
      related = e;
      matchedBy = parsed.inReplyTo && msgIds(parsed.inReplyTo).includes(mid) ? "in-reply-to" : "references";
      break;
    }
  }
  if (!related && isBounce) {
    const quoted = raw.match(new RegExp(`<ts\\.[a-z0-9]+\\.[a-z0-9]+@${ourDomain.replace(/\./g, "\\.")}>`, "i"))?.[0];
    const headerId = /X-TraceSign-Email-Id:\s*([a-z0-9]+)/i.exec(raw)?.[1];
    const [e] = quoted
      ? await db.select(REL).from(t.emailMessages).where(eq(t.emailMessages.messageId, quoted))
      : headerId
        ? await db.select(REL).from(t.emailMessages).where(eq(t.emailMessages.id, headerId))
        : [];
    if (e) {
      related = e;
      matchedBy = "bounce";
    }
  }

  let documentId = related?.documentId ?? null;
  // Last resort for plain replies: the sender is a recipient of exactly one document.
  if (!documentId && kind === "reply" && fromAddr) {
    const docs = await db.selectDistinct({ documentId: t.recipients.documentId }).from(t.recipients).where(eq(t.recipients.email, fromAddr)).limit(2);
    if (docs.length === 1) {
      documentId = docs[0].documentId;
      matchedBy = "sender";
    }
  }

  const text = (parsed.text ?? "").slice(0, 20_000);
  const inserted = await db
    .insert(t.inboundEmails)
    .values({
        mailbox,
        uidValidity,
        uid,
        messageId,
        fromEmail: fromAddr,
        fromName: parsed.from?.value[0]?.name || null,
        toList: addrList(parsed.to as AddressObject | AddressObject[] | undefined) || null,
        subject: subject || null,
        sentAt: parsed.date ?? (msg.internalDate ? new Date(msg.internalDate) : null),
        inReplyTo: msgIds(parsed.inReplyTo).join(" ") || null,
        references: msgIds(parsed.references).join(" ") || null,
        textBody: text || null,
        rawSource: source.length <= MAX_STORED_SOURCE ? raw : `${raw.slice(0, raw.indexOf("\r\n\r\n") + 4)}[Message larger than 20 MB; body not copied. The original remains in the mailbox, UID ${uid}.]`,
        kind,
        documentId,
        matchedBy,
        relatedEmailId: related?.id ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: t.inboundEmails.id });
  if (!inserted.length) return "duplicate"; // same Message-ID already imported (e.g. also present in another folder)

  if (isBounce && related?.messageId) {
    const diag = /Diagnostic-Code:\s*([^\r\n]+)/i.exec(raw)?.[1] ?? /Status:\s*(5\.\d+\.\d+)/i.exec(raw)?.[0] ?? "Bounce received";
    const permanent = /Action:\s*failed/i.test(raw) || /Status:\s*5\./i.test(raw) || !/Action:\s*delayed/i.test(raw);
    if (permanent) await recordDeliveryStatus(related.messageId, "bounced", diag);
  }
  if (documentId) {
    await db.insert(t.documentEvents).values({
      documentId,
      type: kind === "bounce" ? "bounce_received" : kind === "auto_reply" ? "auto_reply_received" : "reply_received",
      detail: `${fromAddr ?? "unknown sender"}: ${subject}`.slice(0, 300),
    });
  }
  return { kind, documentId };
}

/**
 * Looks up a test email in the connected mailbox and checks the From header the
 * provider actually delivered. Detects providers that silently rewrite the alias.
 */
export async function verifyAliasViaImap(messageId: string): Promise<{ ok: boolean; status: string; message: string }> {
  const s = await getSettings();
  let c: ImapFlow | null = null;
  try {
    c = client(s);
    await c.connect();
    const lock = await c.getMailboxLock(s.imapMailbox, { readOnly: true });
    try {
      const uids = ((await c.search({ header: { "message-id": messageId } }, { uid: true })) || []) as number[];
      if (!uids.length) {
        return {
          ok: false,
          status: "pending",
          message: `The test email hasn't arrived in “${s.imapMailbox}” yet. Send the test to ${s.fromEmail} (or the parent mailbox) and try again in a minute.`,
        };
      }
      const m = await c.fetchOne(String(uids[uids.length - 1]), { envelope: true }, { uid: true });
      const got = m && m.envelope?.from?.[0]?.address?.toLowerCase();
      if (got === s.fromEmail.toLowerCase()) {
        await updateSettings({ aliasStatus: "ok", aliasDetail: `Verified: delivered with From ${got}.` });
        return { ok: true, status: "ok", message: `Verified. The message arrived with From: ${got}.` };
      }
      const detail = `Your provider accepted the email but delivered it as From: ${got ?? "unknown"} instead of ${s.fromEmail}. Recipients would see the mailbox address. Add ${s.fromEmail} as an alias/"Send As" address of ${s.smtpUser}.`;
      await updateSettings({ aliasStatus: "rewritten", aliasDetail: detail });
      return { ok: false, status: "rewritten", message: detail };
    } finally {
      lock.release();
    }
  } catch (err) {
    return { ok: false, status: "error", message: imapError(err, imapCredentials(s)?.pass) };
  } finally {
    await c?.logout().catch(() => undefined);
  }
}
