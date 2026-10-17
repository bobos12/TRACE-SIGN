import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, t } from "../db";
import { appUrl } from "../env";
import { getSettings, smtpPassword, updateSettings } from "../settings";
import { buildTransport, describeSmtpError, makeMessageId } from "./transport";
import { logoAttachment, renderEmail } from "./templates";
import { logEmailEvent } from "./outbox";

export interface TestResult {
  ok: boolean;
  code?: string;
  message: string;
  messageId?: string;
}

/** Connects, negotiates TLS and authenticates, without sending anything. */
export async function testSmtpConnection(): Promise<TestResult> {
  const s = await getSettings();
  let pass = "";
  try {
    pass = smtpPassword(s) ?? "";
    const tr = buildTransport(s);
    try {
      await tr.verify();
    } finally {
      tr.close();
    }
    await updateSettings({ lastSmtpTestAt: new Date(), lastSmtpTestOk: true, lastSmtpError: null });
    return {
      ok: true,
      message: `Connected to ${s.smtpHost}:${s.smtpPort} (${s.smtpSecurity.toUpperCase()}) and authenticated as ${s.smtpUser}. Now send a test email to confirm the server accepts ${s.fromEmail} as the sender.`,
    };
  } catch (err) {
    const f = describeSmtpError(err, { fromEmail: s.fromEmail, smtpUser: s.smtpUser, secretsToRedact: [pass] });
    await updateSettings({ lastSmtpTestAt: new Date(), lastSmtpTestOk: false, lastSmtpError: f.message });
    return { ok: false, code: f.code, message: f.message };
  }
}

/**
 * Sends a real message From the configured alias. Providers that don't allow the
 * authenticated mailbox to use the alias reject at MAIL FROM → ALIAS_REJECTED.
 */
export async function sendTestEmail(to: string): Promise<TestResult> {
  const s = await getSettings();
  const [row] = await db
    .insert(t.emailMessages)
    .values({
      idempotencyKey: `test:${randomUUID()}`,
      kind: "test",
      toEmail: to,
      subject: "TRACE.SIGN test email",
      payload: "{}",
      status: "sending",
      attempts: 1,
      lockedAt: new Date(),
    })
    .returning();
  await logEmailEvent(row.id, "queued", "Test email from Email Integration");
  const messageId = makeMessageId(row.id, s.fromEmail);
  let pass = "";
  try {
    pass = smtpPassword(s) ?? "";
    const tr = buildTransport(s);
    const r = renderEmail("test", { sentAt: new Date().toISOString(), fromName: s.fromName, fromEmail: s.fromEmail }, { appUrl: appUrl() });
    try {
      const info = await tr.sendMail({
        from: { name: s.fromName, address: s.fromEmail },
        replyTo: s.replyTo || undefined,
        to,
        subject: r.subject,
        html: r.html,
        text: r.text,
        messageId,
        attachments: [logoAttachment()],
        envelope: { from: s.fromEmail, to: [to] },
        headers: { "X-TraceSign-Email-Id": row.id, "X-TraceSign-Test": "1", "Auto-Submitted": "auto-generated" },
      });
      if (info.rejected?.length) throw (info as { rejectedErrors?: Error[] }).rejectedErrors?.[0] ?? Object.assign(new Error(`Recipient rejected: ${String(info.rejected[0])}`), { command: "RCPT TO", responseCode: 550 });
      await db
        .update(t.emailMessages)
        .set({ status: "sent", sentAt: new Date(), lockedAt: null, messageId, smtpResponse: String(info.response).slice(0, 300) })
        .where(eq(t.emailMessages.id, row.id));
      await logEmailEvent(row.id, "sent", "Accepted by SMTP server");
    } finally {
      tr.close();
    }
    await updateSettings({
      lastSmtpTestAt: new Date(),
      lastSmtpTestOk: true,
      lastSmtpError: null,
      aliasStatus: s.aliasStatus === "rewritten" ? "rewritten" : "ok",
      aliasDetail: s.aliasStatus === "rewritten" ? s.aliasDetail : `SMTP server accepted ${s.fromEmail} as sender for mailbox ${s.smtpUser}.`,
    });
    return {
      ok: true,
      messageId,
      message: `Test email accepted by ${s.smtpHost} for delivery to ${to}. Confirm the From line shows ${s.fromName} <${s.fromEmail}>. With IMAP connected, “Verify alias” checks this automatically.`,
    };
  } catch (err) {
    const f = describeSmtpError(err, { fromEmail: s.fromEmail, smtpUser: s.smtpUser, secretsToRedact: [pass] });
    await db.update(t.emailMessages).set({ status: "failed", lockedAt: null, lastError: `[${f.code}] ${f.message}` }).where(eq(t.emailMessages.id, row.id));
    await logEmailEvent(row.id, "failed", f.code);
    await updateSettings({
      lastSmtpTestAt: new Date(),
      lastSmtpTestOk: false,
      lastSmtpError: f.message,
      ...(f.code === "ALIAS_REJECTED" ? { aliasStatus: "rejected", aliasDetail: f.message } : {}),
    });
    return { ok: false, code: f.code, message: f.message };
  }
}
