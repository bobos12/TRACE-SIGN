// Branded, white-label email templates. Table-based, inline-styled HTML that renders in
// Gmail, Outlook (desktop + web, VML button), Apple Mail and mobile clients, plus a
// plain-text part. Brand name, accent colour and logo come from the sending workspace.

import { readFileSync } from "fs";
import { join } from "path";
import { formatPacific } from "../geometry";

export const LOGO_CID = "brand-mark@trace-sign";
let defaultLogo: Buffer | null = null;

/** Inline logo attachment referenced by every template (workspace logo, or the TRACE mark). */
export function logoAttachment(custom?: Buffer | null) {
  defaultLogo ??= readFileSync(join(process.cwd(), "public", "brand", "trace-sign-mark.png"));
  return { filename: "logo.png", content: custom ?? defaultLogo, contentType: "image/png", cid: LOGO_CID, contentDisposition: "inline" as const };
}

export type EmailKind = "invite" | "reminder" | "opened" | "declined" | "cancelled" | "completed" | "expired" | "completed_pdf" | "test";

export interface Signer {
  name: string;
  email: string;
  signedAt: string;
}

export type Payload = {
  documentTitle?: string;
  recipientName?: string;
  recipientEmail?: string;
  senderName?: string;
  message?: string | null;
  expiresAt?: string | null;
  reminderNumber?: number;
  reason?: string | null;
  signers?: Signer[];
  audience?: "recipient" | "admin";
  openedAt?: string;
  declinedBy?: string;
  sentAt?: string;
  fromName?: string;
  fromEmail?: string;
};

/** Links resolved at send time (never stored in the outbox). */
export interface Links {
  appUrl: string;
  signUrl?: string;
  adminDocUrl?: string;
  /** How the completed PDF travels: attached, or behind an authenticated link. */
  delivery?: "attachment" | "link";
  auditAttached?: boolean;
}

export interface EmailBrand {
  name: string; // e.g. "TRACE.SIGN", "TRAVIS BAIL.SIGN"
  company: string; // e.g. "TRACE.STUDIO"
  accent: string; // #RRGGBB
  poweredBy: boolean; // show "Powered by TRACE.STUDIO"
}

export const DEFAULT_BRAND: EmailBrand = { name: "TRACE.SIGN", company: "TRACE.STUDIO", accent: "#FF5A33", poweredBy: true };

const C = { bg: "#F5F5F4", card: "#FFFFFF", ink: "#18181B", body: "#3F3F46", muted: "#71717A", line: "#E4E4E7", soft: "#FAFAF9" };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return formatPacific(iso);
}

/** "TRACE.SIGN" → TRACE<accent>.</accent>SIGN */
function wordmark(name: string, accent: string) {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return esc(name);
  return `${esc(name.slice(0, i))}<span style="color:${accent};">.</span>${esc(name.slice(i + 1))}`;
}

interface Block {
  preheader: string;
  eyebrow?: string;
  heading: string;
  paragraphs: string[]; // already-escaped HTML fragments
  button?: { label: string; url: string };
  details?: [string, string][];
  footnote?: string; // escaped HTML
}

function layout(b: Block, brand: EmailBrand): string {
  const A = brand.accent;
  const paras = b.paragraphs.map((p) => `<p style="margin:0 0 16px;font:400 15px/1.65 ${FONT};color:${C.body};">${p}</p>`).join("");
  const details = b.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;background:${C.soft};border:1px solid ${C.line};border-radius:10px;">
        ${b.details
          .map(
            ([k, v], i) => `<tr>
              <td style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ""}font:500 13px/1.4 ${FONT};color:${C.muted};width:36%;vertical-align:top;">${esc(k)}</td>
              <td style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ""}font:500 14px/1.4 ${FONT};color:${C.ink};vertical-align:top;">${esc(v)}</td>
            </tr>`,
          )
          .join("")}
      </table>`
    : "";
  const button = b.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 26px;">
        <tr><td bgcolor="${A}" style="border-radius:8px;">
          <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(b.button.url)}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="17%" stroke="f" fillcolor="${A}"><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${esc(b.button.label)}</center></v:roundrect><![endif]-->
          <!--[if !mso]><!-- --><a href="${esc(b.button.url)}" target="_blank" style="display:inline-block;padding:14px 26px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${esc(b.button.label)}</a><!--<![endif]-->
        </td></tr>
      </table>
      <p style="margin:0 0 24px;font:400 12px/1.6 ${FONT};color:${C.muted};">Button not working? Paste this link into your browser:<br><a href="${esc(b.button.url)}" style="color:${C.body};word-break:break-all;">${esc(b.button.url)}</a></p>`
    : "";

  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(b.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(b.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.bg}" style="background:${C.bg};">
<tr><td align="center" style="padding:36px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
    <tr><td style="padding:0 4px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;padding-right:10px;"><img src="cid:${LOGO_CID}" width="36" height="26" alt="" style="display:block;border:0;height:26px;width:36px;"></td>
        <td style="vertical-align:middle;font:700 15px/1 ${FONT};letter-spacing:.14em;color:${C.ink};">${wordmark(brand.name, A)}</td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:14px;padding:36px 34px 8px;">
      <div style="height:3px;width:40px;background:${A};border-radius:2px;margin:0 0 22px;"></div>
      ${b.eyebrow ? `<p style="margin:0 0 8px;font:600 12px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.muted};">${esc(b.eyebrow)}</p>` : ""}
      <h1 style="margin:0 0 18px;font:700 23px/1.3 ${FONT};color:${C.ink};letter-spacing:-.01em;">${esc(b.heading)}</h1>
      ${paras}${details}${button}
      ${b.footnote ? `<p style="margin:0 0 28px;font:400 12.5px/1.6 ${FONT};color:${C.muted};">${b.footnote}</p>` : ""}
    </td></tr>
    <tr><td align="center" style="padding:22px 16px 0;font:400 11.5px/1.7 ${FONT};color:${C.muted};">
      Sent by ${esc(brand.name)}${brand.company ? ` on behalf of ${esc(brand.company)}` : ""}.<br>
      Signing links are personal to you. Please don't forward them.
      ${brand.poweredBy ? `<br><span style="letter-spacing:.08em;">POWERED BY <strong style="color:${C.ink};">TRACE.STUDIO</strong></span>` : ""}
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function plain(b: Block, brand: EmailBrand): string {
  const lines = [b.heading, "", ...b.paragraphs.map(stripTags).flatMap((p) => [p, ""])];
  if (b.details?.length) lines.push(...b.details.map(([k, v]) => `${k}: ${v}`), "");
  if (b.button) lines.push(`${b.button.label}: ${b.button.url}`, "");
  if (b.footnote) lines.push(stripTags(b.footnote), "");
  lines.push(`— ${brand.name}${brand.poweredBy ? " · Powered by TRACE.STUDIO" : ""}`);
  return lines.join("\n");
}

export function subjectFor(kind: EmailKind, p: Payload, brand: EmailBrand = DEFAULT_BRAND): string {
  const t = p.documentTitle ?? "Document";
  switch (kind) {
    case "invite":
      return `Signature requested: ${t}`;
    case "reminder":
      return `Reminder: please sign ${t}`;
    case "opened":
      return `${p.recipientName ?? p.recipientEmail} opened ${t}`;
    case "declined":
      return `Declined: ${t}`;
    case "cancelled":
      return `Signature request cancelled: ${t}`;
    case "completed":
      return `Completed: ${t}`;
    case "expired":
      return `Signature request expired: ${t}`;
    case "completed_pdf":
      return `Your signed copy: ${t}`;
    case "test":
      return `${brand.name} test email`;
  }
}

export function renderEmail(kind: EmailKind, p: Payload, links: Links, brand: EmailBrand = DEFAULT_BRAND): { subject: string; html: string; text: string } {
  const title = p.documentTitle ?? "Document";
  const hello = `Hi ${esc(p.recipientName || "there")},`;
  const from = p.senderName || brand.company || brand.name;
  let b: Block;

  switch (kind) {
    case "invite":
    case "reminder": {
      const isRem = kind === "reminder";
      b = {
        preheader: `${from} sent you ${title} to sign.`,
        eyebrow: isRem ? "Reminder" : "Signature request",
        heading: isRem ? `${title} is waiting for your signature` : `${from} sent you a document to sign`,
        paragraphs: [
          hello,
          isRem
            ? `This is a reminder that <strong>${esc(title)}</strong> still needs your signature.`
            : `Please review and sign <strong>${esc(title)}</strong>. It only takes a minute and you don't need an account.`,
          ...(p.message ? [`<span style="display:block;border-left:3px solid ${C.line};padding:2px 0 2px 14px;color:${C.body};"><em>${esc(from)} wrote:</em><br>${esc(p.message).replace(/\n/g, "<br>")}</span>`] : []),
        ],
        details: [
          ["Document", title],
          ["From", from],
        ],
        button: links.signUrl ? { label: "Review and sign", url: links.signUrl } : undefined,
        footnote: `Not expecting this? You can ignore this email or decline on the signing page. Questions about the document? Reply to this email.`,
      };
      break;
    }
    case "opened":
      b = {
        preheader: `${p.recipientName} opened ${title}.`,
        eyebrow: "Activity",
        heading: `${p.recipientName} opened your document`,
        paragraphs: [`<strong>${esc(p.recipientName)}</strong> (${esc(p.recipientEmail)}) opened <strong>${esc(title)}</strong>.`],
        details: [
          ["Document", title],
          ["Opened", fmtDate(p.openedAt)],
        ],
        button: links.adminDocUrl ? { label: "View status", url: links.adminDocUrl } : undefined,
        footnote: "You can turn off opened notifications in Settings → Email.",
      };
      break;
    case "declined":
      b = {
        preheader: `${p.recipientName} declined to sign ${title}.`,
        eyebrow: "Declined",
        heading: `${p.recipientName} declined to sign`,
        paragraphs: [`<strong>${esc(p.recipientName)}</strong> (${esc(p.recipientEmail)}) declined to sign <strong>${esc(title)}</strong>. The request is closed and the other recipients were told.`],
        details: [
          ["Document", title],
          ["Reason", p.reason || "No reason given"],
        ],
        button: links.adminDocUrl ? { label: "Open document", url: links.adminDocUrl } : undefined,
      };
      break;
    case "cancelled":
      b = {
        preheader: `The signature request for ${title} was cancelled.`,
        eyebrow: "Cancelled",
        heading: "This signature request was cancelled",
        paragraphs: [hello, `The request to sign <strong>${esc(title)}</strong> was cancelled${p.declinedBy ? " because another recipient declined" : " by the sender"}. You don't need to do anything.`],
      };
      break;
    case "completed":
      b = {
        preheader: `${title} has been signed by everyone.`,
        eyebrow: "Completed",
        heading: `${title} is fully signed`,
        paragraphs: [`Everyone has signed <strong>${esc(title)}</strong>. The signed PDF is in your dashboard.`],
        details: (p.signers ?? []).map((s) => [s.name, `Signed ${fmtDate(s.signedAt)}`] as [string, string]),
        button: links.adminDocUrl ? { label: "Open document", url: links.adminDocUrl } : undefined,
      };
      break;
    case "expired":
      b =
        p.audience === "admin"
          ? {
              preheader: `${title} expired before everyone signed.`,
              eyebrow: "Expired",
              heading: "A signature request expired",
              paragraphs: [`<strong>${esc(title)}</strong> expired before everyone signed.`],
              details: (p.signers ?? []).map((s) => [s.name, s.signedAt ? `Signed ${fmtDate(s.signedAt)}` : "Not signed"] as [string, string]),
              button: links.adminDocUrl ? { label: "Open document", url: links.adminDocUrl } : undefined,
            }
          : {
              preheader: `The signing link for ${title} has expired.`,
              eyebrow: "Expired",
              heading: "This signature request has expired",
              paragraphs: [hello, `The request to sign <strong>${esc(title)}</strong> has expired and the link no longer works.`, `If you still need to sign, reply to this email and the sender can send a new request.`],
            };
      break;
    case "completed_pdf": {
      const attached = links.delivery !== "link";
      const sender = p.audience === "admin";
      b = {
        preheader: `The signed copy of ${title} is ready.`,
        eyebrow: "Completed",
        heading: "Your signed copy is ready",
        paragraphs: [
          hello,
          `<strong>${esc(title)}</strong> has been signed by everyone.${attached ? " The signed PDF is attached to this email." : ""}`,
          attached
            ? `${links.auditAttached ? "The audit trail is attached as a separate file. " : ""}You can also download it using the secure link below.`
            : `For security, the signed PDF isn't attached. Use the secure link below to download it.`,
        ],
        button: sender && links.adminDocUrl ? { label: "Open document", url: links.adminDocUrl } : links.signUrl ? { label: "Download signed PDF", url: links.signUrl } : links.adminDocUrl ? { label: "Open document", url: links.adminDocUrl } : undefined,
        footnote: "Keep this copy for your records.",
      };
      break;
    }
    case "test":
      b = {
        preheader: `Your ${brand.name} email integration is working.`,
        eyebrow: "Test",
        heading: `Test email from ${brand.name}`,
        paragraphs: [
          `This message confirms that ${esc(brand.name)} can send email through your SMTP server using the configured sender address.`,
          `Check the <strong>From</strong> line in your inbox: it should read <strong>${esc(p.fromName ?? brand.name)} &lt;${esc(p.fromEmail ?? "")}&gt;</strong>. If your provider replaced it with the mailbox address, the alias isn't authorized for sending.`,
        ],
        details: [["Sent", fmtDate(p.sentAt)]],
      };
      break;
  }
  return { subject: subjectFor(kind, p, brand), html: layout(b, brand), text: plain(b, brand) };
}
