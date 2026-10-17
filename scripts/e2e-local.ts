/**
 * End-to-end test against REAL local mail servers (no mocks of the mail code):
 *   - smtp-server  : a real SMTP server with AUTH; can refuse the alias at MAIL FROM
 *   - hoodiecrow   : a real IMAP4rev1 server
 *   - PGlite       : PostgreSQL compiled to WASM, running the same migration SQL
 *
 *   npm i --no-save smtp-server hoodiecrow-imap && npx tsx scripts/e2e-local.ts
 */
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { simpleParser } from "mailparser";

const ALIAS = "trace.sign@trace-studio.tech";
const PARENT = "hello@trace-studio.tech";
const MAILBOX_PASSWORD = "Parent-Mailbox-Pa55!" + randomBytes(4).toString("hex");

process.env.APP_URL = "https://sign.trace-studio.tech";
process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = randomBytes(32).toString("base64");
process.env.ADMIN_EMAIL = "owner@trace-studio.tech";
process.env.ADMIN_PASSWORD_HASH = "scrypt:x:y";

let pass = 0;
let fail = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`  ✘ ${name}`, extra ?? "");
  }
}

async function main() {
  // ── Database ────────────────────────────────────────────────────────────
  const pg = new PGlite();
  for (const f of ["drizzle/0000_init.sql", "drizzle/0001_v2_editor.sql", "drizzle/0002_pacific_time.sql"]) {
    for (const stmt of readFileSync(f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
  }
  const schema = await import("../src/lib/schema");
  (globalThis as Record<string, unknown>).__tsDb = drizzle(pg, { schema });

  const { db, t } = await import("../src/lib/db");
  const settings = await import("../src/lib/settings");
  const outbox = await import("../src/lib/mail/outbox");
  const tests = await import("../src/lib/mail/smtp-tests");
  const imap = await import("../src/lib/mail/imap");
  const docs = await import("../src/lib/documents");
  const { signingToken } = await import("../src/lib/crypto");
  const { randomUUID } = await import("crypto");
  const nid = () => randomUUID().replace(/-/g, "");
  const actor = { label: "sender:owner@trace-studio.tech", ip: "203.0.113.1", userAgent: "e2e" };
  const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  /** v2 flow: draft → recipients + one signature field each → send (parallel). */
  async function createAndSend(o: { title: string; message?: string; fileName: string; file: Buffer; recipients: { name: string; email: string }[]; expiresInDays: number; reminderEveryDays: number; maxReminders: number }) {
    const d = await docs.createDraft({ orgId: "default", createdBy: "env", senderEmail: "owner@trace-studio.tech", senderName: "TRACE.SIGN", file: o.file, fileName: o.fileName, title: o.title }, actor);
    const rs = o.recipients.map((r, i) => ({ id: nid(), name: r.name, email: r.email, roleLabel: null, order: 1, color: ["#3B6FF5", "#E8590C"][i % 2] }));
    await docs.saveDraft(d.id, "default", docs.draftInput.parse({ title: o.title, message: o.message ?? null, signingOrder: "parallel", expiresInDays: o.expiresInDays, reminderEveryDays: o.reminderEveryDays, maxReminders: o.maxReminders, recipients: rs, fields: rs.map((r, i) => ({ id: nid(), recipientId: r.id, type: "signature", page: 0, x: 0.1 + i * 0.4, y: 0.8, w: 0.3, h: 0.06 })) }));
    return docs.sendDocument(d.id, "default", actor);
  }
  const signAs = (token: string, name: string, meta: { ip: string; agent: string }) => docs.completeSigning(token, { consent: true, values: {}, signature: { method: "typed", png: SIG, text: name } }, { label: "recipient", ip: meta.ip, userAgent: meta.agent });

  // ── Mail servers ────────────────────────────────────────────────────────
  const { SMTPServer } = await import("smtp-server");
  // @ts-expect-error untyped test dependency
  const hoodiecrow = (await import("hoodiecrow-imap")).default;
  const imapServer = hoodiecrow({ users: { [PARENT]: { password: MAILBOX_PASSWORD } }, plugins: ["UIDPLUS", "ESEARCH", "SPECIAL-USE"] });
  await new Promise<void>((r) => imapServer.listen(11430, r));

  const received: { from: string; to: string[]; raw: Buffer }[] = [];
  const smtpLog: string[] = [];
  const ctl = { allowAlias: true, tempFailFor: "" };
  const smtp = new SMTPServer({
    secure: false,
    authOptional: false,
    disabledCommands: ["STARTTLS"],
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _s, cb) {
      smtpLog.push(`AUTH ${auth.username}`);
      if (auth.username === PARENT && auth.password === MAILBOX_PASSWORD) return cb(null, { user: PARENT });
      return cb(Object.assign(new Error("5.7.8 Authentication credentials invalid"), { responseCode: 535 }));
    },
    onMailFrom(addr, _s, cb) {
      if (addr.address === ALIAS && !ctl.allowAlias) {
        return cb(Object.assign(new Error(`5.7.1 <${ALIAS}>: Sender address rejected: not owned by user ${PARENT}`), { responseCode: 553 }));
      }
      cb();
    },
    onRcptTo(addr, _s, cb) {
      if (ctl.tempFailFor && addr.address === ctl.tempFailFor) {
        return cb(Object.assign(new Error("4.7.1 Try again later"), { responseCode: 451 }));
      }
      cb();
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const raw = Buffer.concat(chunks);
        const to = session.envelope.rcptTo.map((r) => r.address);
        received.push({ from: (session.envelope.mailFrom as { address: string }).address, to, raw });
        // Mail for the alias or the parent mailbox lands in the parent INBOX (like a real alias).
        if (to.some((a) => a === ALIAS || a === PARENT)) imapServer.appendMessage("INBOX", [], new Date(), raw.toString("binary"));
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(25250, "127.0.0.1", r));

  // ── 1. Settings & encryption ────────────────────────────────────────────
  console.log("\n1. Settings");
  await settings.saveSettings(
    settings.settingsInput.parse({
      smtpHost: "127.0.0.1",
      smtpPort: 25250,
      smtpSecurity: "none",
      smtpUser: PARENT,
      smtpPassword: MAILBOX_PASSWORD,
      fromEmail: ALIAS,
      fromName: "TRACE.SIGN",
      replyTo: PARENT,
      imapEnabled: true,
      imapHost: "127.0.0.1",
      imapPort: 11430,
      imapSecure: false,
      imapUseSmtpLogin: true,
      imapUser: "",
      imapMailbox: "INBOX",
      imapReadOnly: true,
      imapInitialLookbackDays: 14,
      adminNotifyEmail: "owner@trace-studio.tech",
      notifyOnOpen: true,
      notifyOnDecline: true,
      notifyOnComplete: true,
      notifyOnExpire: true,
    }),
  );
  const s0 = await settings.getSettings();
  check("password stored encrypted (v1 AES-GCM), not plaintext", s0.smtpPassEnc?.startsWith("v1:") && !s0.smtpPassEnc.includes(MAILBOX_PASSWORD));
  check("public settings expose no password", !JSON.stringify(settings.publicSettings(s0)).includes("PassEnc") && settings.publicSettings(s0).hasSmtpPassword);

  // ── 2. SMTP tests ───────────────────────────────────────────────────────
  console.log("\n2. SMTP connection + test email");
  const conn = await tests.testSmtpConnection();
  check("Test connection succeeds with parent mailbox login", conn.ok, conn);
  const test1 = await tests.sendTestEmail(ALIAS);
  check("Test email accepted", test1.ok, test1);
  const last = received.at(-1)!;
  const parsedTest = await simpleParser(last.raw);
  check("Envelope MAIL FROM is the alias", last.from === ALIAS, last.from);
  check("From header is TRACE.SIGN <alias>", parsedTest.from?.value[0].address === ALIAS && parsedTest.from?.value[0].name === "TRACE.SIGN", parsedTest.from?.text);
  check("Authenticated as parent mailbox (alias has no login)", smtpLog.every((l) => l === `AUTH ${PARENT}`));

  const v = await imap.verifyAliasViaImap(test1.messageId!);
  check("Verify alias via IMAP finds the test and confirms From", v.ok && v.status === "ok", v);

  ctl.allowAlias = false;
  const rejected = await tests.sendTestEmail(ALIAS);
  check("Provider refusing the alias → ALIAS_REJECTED with clear error", !rejected.ok && rejected.code === "ALIAS_REJECTED" && rejected.message.includes("Send As"), rejected);
  check("Alias status recorded as rejected", (await settings.getSettings()).aliasStatus === "rejected");
  ctl.allowAlias = true;

  const badPw = await (async () => {
    const s = await settings.getSettings();
    await settings.updateSettings({ smtpPassEnc: (await import("../src/lib/crypto")).encryptSecret("wrong") });
    const r = await tests.testSmtpConnection();
    await settings.updateSettings({ smtpPassEnc: s.smtpPassEnc });
    return r;
  })();
  check("Wrong password → AUTH_FAILED", !badPw.ok && badPw.code === "AUTH_FAILED", badPw);

  // ── 3. Document lifecycle ───────────────────────────────────────────────
  console.log("\n3. Signature workflow emails");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  page.drawText("Service Agreement — test", { x: 60, y: 760, size: 18, font: await pdf.embedFont(StandardFonts.Helvetica) });
  const file = Buffer.from(await pdf.save());

  const before = received.length;
  const doc = await createAndSend({
    title: "Website Development Agreement",
    message: "Please sign by Friday.",
    fileName: "agreement.pdf",
    file,
    recipients: [
      { name: "Sara Client", email: "sara@client.example" },
      { name: "Omar Partner", email: "omar@client.example" },
    ],
    expiresInDays: 14,
    reminderEveryDays: 3,
    maxReminders: 3,
  });
  const recs = await db.select().from(t.recipients).where(eq(t.recipients.documentId, doc.id));
  const dup = await outbox.enqueueEmail({ idempotencyKey: `invite:${recs[0].id}:v1`, kind: "invite", toEmail: recs[0].email, payload: {} });
  check("Re-enqueueing an invite is a no-op (no duplicate)", dup.created === false);

  let r = await outbox.processOutbox();
  check("Two invitations sent", "sent" in r && r.sent === 2, r);
  const invite = await simpleParser(received[before].raw);
  check("Invite subject = Signature requested: [Document Name]", invite.subject === "Signature requested: Website Development Agreement", invite.subject);
  check("Invite From = TRACE.SIGN <trace.sign@trace-studio.tech>", invite.from?.text === `"TRACE.SIGN" <${ALIAS}>` || invite.from?.text === `TRACE.SIGN <${ALIAS}>`, invite.from?.text);
  const link = (invite.html || "").match(/https:\/\/sign\.trace-studio\.tech\/sign\/[A-Za-z0-9._-]+/)?.[0];
  check("Signing link uses the TRACE.SIGN app domain", !!link, (invite.html || "").slice(0, 200));
  check("Invite has HTML + plain-text parts and the greeting", !!invite.text?.includes("Hi Sara Client,") && String(invite.html).includes("Review and sign"));
  check("Outbox stores no signing link", !(await db.select().from(t.emailMessages)).some((e) => e.payload.includes("/sign/")));

  r = await outbox.processOutbox();
  check("Processing again sends nothing (no duplicate invites)", "sent" in r && r.sent === 0);

  // Manual reminder
  await docs.sendReminder(recs[1].id, { manual: true });
  let threw = false;
  try {
    await docs.sendReminder(recs[1].id, { manual: true });
  } catch {
    threw = true;
  }
  check("Manual reminder throttled within an hour", threw);
  r = await outbox.processOutbox();
  const rem = await simpleParser(received.at(-1)!.raw);
  check("Reminder sent and threaded under the invite", rem.subject?.startsWith("Reminder: please sign") && !!rem.inReplyTo, rem.subject);

  // Open → admin notification
  const tokA = signingToken(recs.find((x) => x.email.startsWith("sara"))!.id, 1);
  const ra = await docs.resolveToken(tokA);
  await docs.markOpened(ra!, actor);
  await docs.markOpened((await docs.resolveToken(tokA))!, actor);
  r = await outbox.processOutbox();
  const openedMails = received.filter((m) => m.to.includes("owner@trace-studio.tech"));
  check("Document-opened notification sent once to admin", openedMails.length === 1 && "sent" in r && r.sent === 1, { n: openedMails.length, r });

  // Retry: recipient MX temporarily refuses
  ctl.tempFailFor = "omar@client.example";
  const omar = recs.find((x) => x.email.startsWith("omar"))!;
  await docs.sendReminder(omar.id, { manual: false }); // (scheduler-style: not throttled)
  r = await outbox.processOutbox();
  const [retrying] = await db.select().from(t.emailMessages).where(eq(t.emailMessages.status, "retrying"));
  check("Temporary 451 → status retrying with backoff", !!retrying && retrying.attempts === 1 && retrying.nextAttemptAt > new Date(), retrying);
  ctl.tempFailFor = "";
  await db.update(t.emailMessages).set({ nextAttemptAt: new Date() }).where(eq(t.emailMessages.id, retrying.id));
  r = await outbox.processOutbox();
  const [afterRetry] = await db.select().from(t.emailMessages).where(eq(t.emailMessages.id, retrying.id));
  const evs = await db.select().from(t.emailEvents).where(eq(t.emailEvents.emailId, retrying.id));
  check("Retried email sent on attempt 2", afterRetry.status === "sent" && afterRetry.attempts === 2, afterRetry);
  check("Event history shows queued → retrying → sent", evs.map((e) => e.status).join(",") === "queued,retrying,sent", evs.map((e) => e.status));

  // Signing → completion
  await signAs(tokA, "Sara Client", { ip: "203.0.113.5", agent: "test" });
  const tokB = signingToken(recs.find((x) => x.email.startsWith("omar"))!.id, 1);
  await signAs(tokB, "Omar Partner", { ip: "203.0.113.6", agent: "test" });
  const [done] = await db.select().from(t.documents).where(eq(t.documents.id, doc.id));
  check("Document completed with generated PDF", done.status === "completed" && !!done.completedPdf && !!done.completedSha256);
  const start = received.length;
  r = await outbox.processOutbox();
  const finals = await Promise.all(received.slice(start).map((m) => simpleParser(m.raw)));
  check("Fully-signed notice sent to admin", finals.some((m) => m.subject === "Completed: Website Development Agreement"));
  const pdfMails = finals.filter((m) => m.subject?.startsWith("Your signed copy:"));
  check("Completed-PDF email to both signers + admin, with PDF attached", pdfMails.length === 3 && pdfMails.every((m) => m.attachments.some((a) => a.contentType === "application/pdf" && a.content.subarray(0, 5).toString() === "%PDF-")), pdfMails.length);
  const reloaded = await PDFDocument.load((await import("../src/lib/crypto")).openBlob(done.completedPdf)!);
  check("Completed PDF keeps the original page count (no certificate page)", reloaded.getPageCount() === 1);

  // Decline flow
  console.log("\n4. Decline, expiry, void");
  const doc2 = await createAndSend({ title: "NDA", fileName: "nda.pdf", file, recipients: [{ name: "A", email: "a@x.example" }, { name: "B", email: "b@x.example" }], expiresInDays: 7, reminderEveryDays: 0, maxReminders: 0 });
  const r2 = await db.select().from(t.recipients).where(eq(t.recipients.documentId, doc2.id));
  await docs.declineAsRecipient(signingToken(r2[0].id, 1), "Terms need changes", { label: "recipient", ip: "1.1.1.1" });
  r = await outbox.processOutbox();
  const k2 = await db.select().from(t.emailMessages).where(eq(t.emailMessages.documentId, doc2.id));
  check("Decline → admin 'Declined' + other recipient 'cancelled'", k2.some((e) => e.kind === "declined" && e.status === "sent") && k2.some((e) => e.kind === "cancelled" && e.toEmail === "b@x.example" && e.status === "sent"));
  let signAfter = "";
  try {
    await signAs(signingToken(r2[1].id, 1), "B", { ip: "", agent: "" });
  } catch (e) {
    signAfter = (e as Error).message;
  }
  check("Cannot sign after a decline", signAfter.includes("declined"), signAfter);

  // Expiry
  const doc3 = await createAndSend({ title: "Quote", fileName: "q.pdf", file, recipients: [{ name: "C", email: "c@x.example" }], expiresInDays: 1, reminderEveryDays: 0, maxReminders: 0 });
  await db.update(t.documents).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(t.documents.id, doc3.id));
  // queued invite becomes irrelevant before it is sent → cancelled, not sent
  check("expireDueDocuments expires 1 document", (await docs.expireDueDocuments()) === 1);
  r = await outbox.processOutbox();
  const k3 = await db.select().from(t.emailMessages).where(eq(t.emailMessages.documentId, doc3.id));
  check("Unsent invite for expired doc is cancelled, expiry emails sent", k3.find((e) => e.kind === "invite")?.status === "cancelled" && k3.filter((e) => e.kind === "expired" && e.status === "sent").length === 2, k3.map((e) => `${e.kind}:${e.status}`));

  // Void + token revocation
  const doc4 = await createAndSend({ title: "Void me", fileName: "v.pdf", file, recipients: [{ name: "D", email: "d@x.example" }], expiresInDays: 0, reminderEveryDays: 0, maxReminders: 0 });
  const [r4] = await db.select().from(t.recipients).where(eq(t.recipients.documentId, doc4.id));
  const oldTok = signingToken(r4.id, 1);
  await docs.voidDocument(doc4.id, "default", "test", actor);
  check("Voiding revokes old signing links", (await docs.resolveToken(oldTok)) === null);
  check("Forged token rejected", (await docs.resolveToken(`${r4.id}.2.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)) === null);
  await outbox.processOutbox();

  // ── 5. IMAP ─────────────────────────────────────────────────────────────
  console.log("\n5. IMAP import (read-only)");
  const [inviteRow] = await db.select().from(t.emailMessages).where(eq(t.emailMessages.idempotencyKey, `invite:${recs[0].id}:v1`));
  const reply = [
    `From: Sara Client <sara@client.example>`,
    `To: TRACE.SIGN <${ALIAS}>`,
    `Subject: Re: Signature Required — Website Development Agreement`,
    `Message-ID: <reply-1@client.example>`,
    `In-Reply-To: ${inviteRow.messageId}`,
    `References: ${inviteRow.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Signed! Can you send me the invoice too?`,
  ].join("\r\n");
  const [cancelledB] = (await db.select().from(t.emailMessages).where(eq(t.emailMessages.toEmail, "b@x.example"))).filter((e) => e.kind === "cancelled");
  const dsn = [
    `From: Mail Delivery System <MAILER-DAEMON@mx.hostinger.com>`,
    `To: ${ALIAS}`,
    `Subject: Undelivered Mail Returned to Sender`,
    `Message-ID: <dsn-1@mx.hostinger.com>`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/report; report-type=delivery-status; boundary="b1"`,
    ``,
    `--b1`,
    `Content-Type: text/plain`,
    ``,
    `I'm sorry to have to inform you that your message could not be delivered.`,
    `--b1`,
    `Content-Type: message/delivery-status`,
    ``,
    `Reporting-MTA: dns; mx.hostinger.com`,
    ``,
    `Final-Recipient: rfc822; b@x.example`,
    `Action: failed`,
    `Status: 5.1.1`,
    `Diagnostic-Code: smtp; 550 5.1.1 <b@x.example>: Recipient address rejected: User unknown`,
    `--b1`,
    `Content-Type: text/rfc822-headers`,
    ``,
    `From: TRACE.SIGN <${ALIAS}>`,
    `To: b@x.example`,
    `Message-ID: ${cancelledB.messageId}`,
    `Subject: Signature request cancelled — NDA`,
    `--b1--`,
  ].join("\r\n");
  const unrelated = [`From: newsletter@shop.example`, `To: ${PARENT}`, `Subject: 50% off`, `Message-ID: <promo@shop.example>`, `Date: ${new Date().toUTCString()}`, ``, `Buy now`].join("\r\n");
  imapServer.appendMessage("INBOX", [], new Date(), reply);
  imapServer.appendMessage("INBOX", [], new Date(), dsn);
  imapServer.appendMessage("INBOX", [], new Date(), unrelated);

  const sync1 = (await imap.syncMailbox()) as Awaited<ReturnType<typeof imap.syncMailbox>> & { imported: number };
  const inbound = await db.select().from(t.inboundEmails);
  check("IMAP sync ran without error", !("error" in sync1 && sync1.error), sync1);
  check("Reply associated with the document via In-Reply-To", inbound.some((m) => m.kind === "reply" && m.documentId === doc.id && m.matchedBy === "in-reply-to"), inbound.map((m) => [m.kind, m.matchedBy]));
  check("Bounce (DSN) imported and matched", inbound.some((m) => m.kind === "bounce" && m.documentId === doc2.id));
  check("Unrelated parent-mailbox mail ignored", !inbound.some((m) => m.subject === "50% off"));
  check("Raw source preserved verbatim", inbound.find((m) => m.messageId === "<reply-1@client.example>")?.rawSource.includes("Can you send me the invoice too?"));
  const [bounced] = await db.select().from(t.emailMessages).where(eq(t.emailMessages.id, cancelledB.id));
  check("Bounced email status → bounced", bounced.status === "bounced" && !!bounced.lastError?.includes("User unknown"), bounced.status);

  const flagsAfter = imapServer.storage.INBOX.messages.map((m: { flags: string[] }) => m.flags.join(" "));
  check("Mailbox untouched: no \\Seen or other flags set", flagsAfter.every((f: string) => !f.includes("\\Seen")), flagsAfter);

  const sync2 = (await imap.syncMailbox()) as { imported: number };
  check("Second sync imports nothing new", sync2.imported === 0, sync2);
  await settings.updateSettings({ imapLastUid: 0 });
  const sync3 = (await imap.syncMailbox()) as { imported: number; duplicates: number };
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.inboundEmails);
  check("Full re-scan finds duplicates but stores no copies", sync3.imported === 0 && sync3.duplicates >= 2 && n === inbound.length, { sync3, n });

  // ── 6. Secrets ──────────────────────────────────────────────────────────
  console.log("\n6. Secrets");
  const dump = JSON.stringify(await pg.query("select * from email_settings")) + JSON.stringify((await db.select().from(t.emailMessages)).map((e) => [e.lastError, e.payload, e.smtpResponse]));
  check("Mailbox password appears nowhere in the database", !dump.includes(MAILBOX_PASSWORD));

  console.log(`\n${pass} passed, ${fail} failed`);
  smtp.close();
  imapServer.close();
  await pg.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
