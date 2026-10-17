import nodemailer, { type Transporter } from "nodemailer";
import type SMTPPool from "nodemailer/lib/smtp-pool";
import type { EmailSettings } from "../schema";
import { smtpPassword } from "../settings";

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigError";
  }
}

export interface SmtpFailure {
  /** Short machine code for the UI and outbox. */
  code: "NOT_CONFIGURED" | "AUTH_FAILED" | "ALIAS_REJECTED" | "RECIPIENT_REJECTED" | "CONNECTION" | "TLS" | "TEMPORARY" | "REJECTED" | "UNKNOWN";
  message: string;
  /** Worth retrying later? */
  transient: boolean;
}

export function buildTransport(s: EmailSettings, opts: { pool?: boolean } = {}): Transporter<SMTPPool.SentMessageInfo> {
  if (!s.smtpHost || !s.smtpPort) throw new MailConfigError("SMTP server hostname and port are not configured.");
  if (!s.smtpUser) throw new MailConfigError("SMTP username is not configured.");
  const pass = smtpPassword(s);
  if (!pass) throw new MailConfigError("SMTP password is not configured.");

  return nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecurity === "ssl", // implicit TLS (usually 465)
    requireTLS: s.smtpSecurity === "starttls", // refuse to continue if STARTTLS isn't offered
    ignoreTLS: s.smtpSecurity === "none",
    auth: { user: s.smtpUser, pass },
    tls: { minVersion: "TLSv1.2", servername: s.smtpHost },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    // One reused connection per batch keeps us well inside mailbox-provider rate limits.
    pool: true,
    maxConnections: opts.pool ? 2 : 1,
    maxMessages: 50,
    // Never let nodemailer print protocol traffic: AUTH lines contain credentials.
    logger: false,
    debug: false,
  } satisfies SMTPPool.Options);
}

type NmError = Error & { code?: string; responseCode?: number; command?: string; response?: string };

/** Turns raw SMTP/Nodemailer errors into something an administrator can act on. */
export function describeSmtpError(err: unknown, ctx: { fromEmail?: string; smtpUser?: string | null; secretsToRedact?: string[] } = {}): SmtpFailure {
  const e = (err ?? {}) as NmError;
  let raw = String(e.response || e.message || err || "Unknown error");
  for (const secret of ctx.secretsToRedact ?? []) if (secret) raw = raw.split(secret).join("•••");
  raw = raw.slice(0, 500);
  const rc = e.responseCode ?? 0;
  const cmd = (e.command || "").toUpperCase();
  const text = raw.toLowerCase();

  if (err instanceof MailConfigError) return { code: "NOT_CONFIGURED", message: err.message, transient: false };

  if (e.code === "EAUTH" || rc === 535 || rc === 534 || cmd.startsWith("AUTH")) {
    return {
      code: "AUTH_FAILED",
      transient: false,
      message: `The SMTP server rejected the login for ${ctx.smtpUser ?? "the configured user"}. Use the parent mailbox's full address and password (or an app password). Aliases usually have no login of their own. Server said: ${raw}`,
    };
  }

  // Some servers (e.g. Hostinger) refuse the alias only once RCPT TO is sent, with a message
  // that names the sender, so explicit sender wording wins regardless of which command failed.
  const explicitSender = /(sender address rejected|sender rejected|not owned by user|from address|not allowed to send as|send as|sendas|sender .*not (allowed|authori[sz]ed|permitted))/;
  const senderWords = /(sender|from address|mail from|not owned|not allowed to send|send as|sendas|unauthori[sz]ed|spoof|not permitted|does not match|mismatch|authenticated user|relay)/;
  if (explicitSender.test(text) || ((cmd.includes("MAIL FROM") || (rc >= 550 && rc <= 554 && senderWords.test(text))) && !cmd.includes("RCPT"))) {
    return {
      code: "ALIAS_REJECTED",
      transient: false,
      message: `The mail server will not let the authenticated mailbox (${ctx.smtpUser ?? "?"}) send as ${ctx.fromEmail ?? "the alias"}. Add ${ctx.fromEmail ?? "the alias"} as an alias or "Send As" address of that mailbox in your email provider's control panel, or log in with a mailbox that owns this address. Server said: ${raw}`,
    };
  }

  if (cmd.includes("RCPT") && rc >= 500) {
    return { code: "RECIPIENT_REJECTED", transient: false, message: `The recipient address was rejected: ${raw}` };
  }

  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH"].includes(e.code || "")) {
    return {
      code: "CONNECTION",
      transient: true,
      message: `Could not reach the SMTP server (${e.code}). Check the hostname, port and encryption method. Port 465 uses SSL; 587 uses STARTTLS. ${raw}`,
    };
  }
  if (e.code === "ETLS" || /certificate|ssl|tls|wrong version number/.test(text)) {
    return { code: "TLS", transient: false, message: `TLS negotiation failed. The encryption method probably doesn't match the port. ${raw}` };
  }
  if (rc >= 400 && rc < 500) return { code: "TEMPORARY", transient: true, message: `Temporary server error, will retry: ${raw}` };
  if (rc >= 500) return { code: "REJECTED", transient: false, message: `The server rejected the message: ${raw}` };
  return { code: "UNKNOWN", transient: true, message: raw };
}

/** Message-IDs are on our own domain and embed the outbox id, so replies and bounces can be traced back. */
export function makeMessageId(emailId: string, fromEmail: string): string {
  const domain = fromEmail.split("@")[1] || "trace-sign.local";
  return `<ts.${emailId}.${Date.now().toString(36)}@${domain}>`;
}

export function parseOutboxIdFromMessageId(mid: string | null | undefined): string | null {
  const m = /<?ts\.([a-z0-9]+)\.[a-z0-9]+@/i.exec(mid || "");
  return m ? m[1] : null;
}
