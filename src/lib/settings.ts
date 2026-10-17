import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, t } from "./db";
import type { EmailSettings } from "./schema";
import { decryptSecret, encryptSecret } from "./crypto";

export const OFFICIAL_SENDER = "trace.sign@trace-studio.tech";

export async function getSettings(): Promise<EmailSettings> {
  const rows = await db.select().from(t.emailSettings).where(eq(t.emailSettings.id, "default"));
  if (rows[0]) return rows[0];
  await db.insert(t.emailSettings).values({ id: "default" }).onConflictDoNothing();
  return (await db.select().from(t.emailSettings).where(eq(t.emailSettings.id, "default")))[0];
}

export async function updateSettings(data: Partial<EmailSettings>): Promise<EmailSettings> {
  await getSettings();
  const [row] = await db
    .update(t.emailSettings)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(t.emailSettings.id, "default"))
    .returning();
  return row;
}

/** Everything the admin UI may see. Passwords are reduced to booleans. */
export function publicSettings(s: EmailSettings) {
  const { smtpPassEnc, imapPassEnc, ...rest } = s;
  return { ...rest, hasSmtpPassword: !!smtpPassEnc, hasImapPassword: !!imapPassEnc };
}
export type PublicSettings = ReturnType<typeof publicSettings>;

const email = z.string().trim().toLowerCase().email();
const optEmail = z.union([email, z.literal("")]).optional();
const host = z.string().trim().max(253).regex(/^[a-zA-Z0-9.-]+$/, "Hostname may only contain letters, digits, dots and hyphens");

export const settingsInput = z.object({
  smtpHost: z.union([host, z.literal("")]),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecurity: z.enum(["ssl", "starttls", "none"]),
  smtpUser: z.string().trim().max(320),
  smtpPassword: z.string().max(1024).optional(), // blank/omitted = keep existing
  clearSmtpPassword: z.boolean().optional(),
  fromEmail: email,
  fromName: z.string().trim().min(1).max(100),
  replyTo: optEmail,

  imapEnabled: z.boolean(),
  imapHost: z.union([host, z.literal("")]),
  imapPort: z.coerce.number().int().min(1).max(65535),
  imapSecure: z.boolean(),
  imapUseSmtpLogin: z.boolean(),
  imapUser: z.string().trim().max(320),
  imapPassword: z.string().max(1024).optional(),
  clearImapPassword: z.boolean().optional(),
  imapMailbox: z.string().trim().min(1).max(200),
  imapReadOnly: z.boolean(),
  imapInitialLookbackDays: z.coerce.number().int().min(0).max(365),

  adminNotifyEmail: optEmail,
  notifyOnOpen: z.boolean(),
  notifyOnDecline: z.boolean(),
  notifyOnComplete: z.boolean(),
  notifyOnExpire: z.boolean(),
});
export type SettingsInput = z.infer<typeof settingsInput>;

export async function saveSettings(input: SettingsInput) {
  const cur = await getSettings();
  const data: Partial<EmailSettings> = {
    smtpHost: input.smtpHost || null,
    smtpPort: input.smtpPort,
    smtpSecurity: input.smtpSecurity,
    smtpUser: input.smtpUser || null,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    replyTo: input.replyTo || null,
    imapEnabled: input.imapEnabled,
    imapHost: input.imapHost || null,
    imapPort: input.imapPort,
    imapSecure: input.imapSecure,
    imapUseSmtpLogin: input.imapUseSmtpLogin,
    imapUser: input.imapUser || null,
    imapMailbox: input.imapMailbox,
    imapReadOnly: input.imapReadOnly,
    imapInitialLookbackDays: input.imapInitialLookbackDays,
    adminNotifyEmail: input.adminNotifyEmail || null,
    notifyOnOpen: input.notifyOnOpen,
    notifyOnDecline: input.notifyOnDecline,
    notifyOnComplete: input.notifyOnComplete,
    notifyOnExpire: input.notifyOnExpire,
  };
  if (input.smtpPassword) data.smtpPassEnc = encryptSecret(input.smtpPassword);
  else if (input.clearSmtpPassword) data.smtpPassEnc = null;
  if (input.imapPassword) data.imapPassEnc = encryptSecret(input.imapPassword);
  else if (input.clearImapPassword) data.imapPassEnc = null;

  // Changing who we send as / which account invalidates the previous alias verdict.
  if (cur.fromEmail !== input.fromEmail || cur.smtpUser !== (input.smtpUser || null) || cur.smtpHost !== (input.smtpHost || null)) {
    data.aliasStatus = "unknown";
    data.aliasDetail = null;
  }
  // Switching mailbox/server resets the IMAP cursor so nothing is skipped.
  if (cur.imapHost !== (input.imapHost || null) || cur.imapMailbox !== input.imapMailbox || cur.imapUser !== (input.imapUser || null)) {
    data.imapUidValidity = null;
    data.imapLastUid = 0;
  }
  return updateSettings(data);
}

export function smtpPassword(s: EmailSettings): string | null {
  return s.smtpPassEnc ? decryptSecret(s.smtpPassEnc) : null;
}

export function imapCredentials(s: EmailSettings): { user: string; pass: string } | null {
  if (s.imapUseSmtpLogin) {
    const pass = smtpPassword(s);
    return s.smtpUser && pass ? { user: s.smtpUser, pass } : null;
  }
  const pass = s.imapPassEnc ? decryptSecret(s.imapPassEnc) : null;
  return s.imapUser && pass ? { user: s.imapUser, pass } : null;
}
