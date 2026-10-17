// TRACE.SIGN data model (PostgreSQL via Drizzle ORM).
// Status columns are text and validated in code.
import { randomUUID } from "crypto";
import { boolean, customType, doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (v) => v,
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v as unknown as Uint8Array)),
});

const id = () => text("id").primaryKey().$defaultFn(() => randomUUID().replace(/-/g, ""));
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();

/**
 * Singleton row (id = "default") holding the Email Integration configuration.
 * Passwords are AES-256-GCM ciphertext; plaintext never leaves the server.
 */
export const emailSettings = pgTable("email_settings", {
  id: text("id").primaryKey().default("default"),

  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port").default(465),
  smtpSecurity: text("smtp_security").notNull().default("ssl"), // ssl | starttls | none
  smtpUser: text("smtp_user"),
  smtpPassEnc: text("smtp_pass_enc"),

  fromEmail: text("from_email").notNull().default("trace.sign@trace-studio.tech"),
  fromName: text("from_name").notNull().default("TRACE.SIGN"),
  replyTo: text("reply_to"),

  aliasStatus: text("alias_status").notNull().default("unknown"), // unknown | ok | rejected | rewritten
  aliasDetail: text("alias_detail"),
  lastSmtpTestAt: ts("last_smtp_test_at"),
  lastSmtpTestOk: boolean("last_smtp_test_ok"),
  lastSmtpError: text("last_smtp_error"),

  imapEnabled: boolean("imap_enabled").notNull().default(false),
  imapHost: text("imap_host"),
  imapPort: integer("imap_port").default(993),
  imapSecure: boolean("imap_secure").notNull().default(true),
  imapUseSmtpLogin: boolean("imap_use_smtp_login").notNull().default(true),
  imapUser: text("imap_user"),
  imapPassEnc: text("imap_pass_enc"),
  imapMailbox: text("imap_mailbox").notNull().default("INBOX"),
  imapReadOnly: boolean("imap_read_only").notNull().default(true),
  imapUidValidity: text("imap_uid_validity"),
  imapLastUid: integer("imap_last_uid").notNull().default(0),
  imapLastSyncAt: ts("imap_last_sync_at"),
  imapLastError: text("imap_last_error"),
  imapInitialLookbackDays: integer("imap_initial_lookback_days").notNull().default(14),

  adminNotifyEmail: text("admin_notify_email"),
  notifyOnOpen: boolean("notify_on_open").notNull().default(true),
  notifyOnDecline: boolean("notify_on_decline").notNull().default(true),
  notifyOnComplete: boolean("notify_on_complete").notNull().default(true),
  notifyOnExpire: boolean("notify_on_expire").notNull().default(true),

  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Tenant / white-label workspace. Every document, template, API key and webhook belongs to one.
 * The first deployment owner lives in the "default" organization.
 */
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID().replace(/-/g, "")),
  name: text("name").notNull(),
  brandName: text("brand_name").notNull().default("TRACE.SIGN"),
  logoPng: bytea("logo_png"),
  accentColor: text("accent_color").notNull().default("#FF5A33"),
  emailFromName: text("email_from_name"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  dateFormat: text("date_format").notNull().default("MMM d, yyyy"),
  completionDelivery: text("completion_delivery").notNull().default("attachment"), // attachment | link
  attachAuditToEmail: boolean("attach_audit_to_email").notNull().default(true),
  sealPdf: boolean("seal_pdf").notNull().default(true),
  sealP12Enc: text("seal_p12_enc"),
  sealCertPem: text("seal_cert_pem"),
  retentionDays: integer("retention_days").notNull().default(0), // 0 = keep forever
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Workspace members. The .env administrator is the built-in owner of the default organization. */
export const users = pgTable(
  "users",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("member"), // owner | admin | member
    lastLoginAt: ts("last_login_at"),
    disabledAt: ts("disabled_at"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), index("users_org_idx").on(t.orgId)],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    title: text("title").notNull(),
    message: text("message"),
    fileName: text("file_name").notNull(),
    fileData: bytea("file_data").notNull(),
    fileSha256: text("file_sha256").notNull(),
    status: text("status").notNull().default("draft"), // draft | sent | completed | declined | expired | voided
    senderName: text("sender_name").notNull().default("TRACE.SIGN"),
    expiresAt: ts("expires_at"),
    reminderEveryDays: integer("reminder_every_days").notNull().default(3),
    maxReminders: integer("max_reminders").notNull().default(3),
    sentAt: ts("sent_at"),
    completedAt: ts("completed_at"),
    completedPdf: bytea("completed_pdf"),
    completedSha256: text("completed_sha256"),
    createdAt: created(),
    // v2
    orgId: text("org_id").notNull().default("default").references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: text("created_by"), // user id ("env" = built-in owner)
    senderEmail: text("sender_email"), // notifications for this document go here
    signingOrder: text("signing_order").notNull().default("parallel"), // parallel | sequential
    expiresInDays: integer("expires_in_days").notNull().default(30), // applied when the draft is sent
    pageCount: integer("page_count"),
    pageInfo: text("page_info"), // JSON [{ w, h, rotation }] as displayed (rotation applied)
    auditPdf: bytea("audit_pdf"),
    auditSha256: text("audit_sha256"),
    sealed: boolean("sealed").notNull().default(false),
    templateId: text("template_id"),
    source: text("source").notNull().default("app"), // app | template | api
    externalRef: text("external_ref"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
  },
  (t) => [index("documents_status_expires_idx").on(t.status, t.expiresAt), index("documents_org_idx").on(t.orgId, t.createdAt)],
);

export const recipients = pgTable(
  "recipients",
  {
    id: id(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    status: text("status").notNull().default("pending"), // pending | sent | opened | signed | declined
    tokenVersion: integer("token_version").notNull().default(1),
    invitedAt: ts("invited_at"),
    openedAt: ts("opened_at"),
    signedAt: ts("signed_at"),
    signatureText: text("signature_text"),
    signerIp: text("signer_ip"),
    signerAgent: text("signer_agent"),
    declinedAt: ts("declined_at"),
    declineReason: text("decline_reason"),
    reminderCount: integer("reminder_count").notNull().default(0),
    lastReminderAt: ts("last_reminder_at"),
    createdAt: created(),
    // v2
    routingOrder: integer("routing_order").notNull().default(1),
    color: text("color").notNull().default("#3B6FF5"),
    roleLabel: text("role_label"),
    consentAt: ts("consent_at"),
    signatureMethod: text("signature_method"), // typed | drawn | uploaded
    signaturePng: bytea("signature_png"), // adopted signature (encrypted at rest), shown in the audit trail
  },
  // Email uniqueness per document is enforced when the document is sent, so drafts can be saved mid-edit.
  (t) => [index("recipients_doc_idx").on(t.documentId), index("recipients_email_idx").on(t.email)],
);

/**
 * Outbox: one row per email that should exist. The unique idempotency key is what
 * makes duplicate signature invitations impossible.
 */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: id(),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text("kind").notNull(), // invite | reminder | opened | declined | cancelled | completed | expired | completed_pdf | test
    toEmail: text("to_email").notNull(),
    toName: text("to_name"),
    subject: text("subject").notNull(),
    payload: text("payload").notNull(), // JSON template context, rendered at send time (no secrets/links stored)
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    recipientId: text("recipient_id").references(() => recipients.id, { onDelete: "set null" }),
    status: text("status").notNull().default("queued"), // queued | sending | sent | retrying | failed | cancelled | delivered | bounced
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lastError: text("last_error"),
    messageId: text("message_id"), // RFC 5322 Message-ID we assign; threads replies and matches bounces
    smtpResponse: text("smtp_response"),
    sentAt: ts("sent_at"),
    deliveredAt: ts("delivered_at"),
    bouncedAt: ts("bounced_at"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("email_messages_idem_uq").on(t.idempotencyKey),
    uniqueIndex("email_messages_msgid_uq").on(t.messageId),
    index("email_messages_due_idx").on(t.status, t.nextAttemptAt),
    index("email_messages_doc_idx").on(t.documentId),
  ],
);

export const emailEvents = pgTable(
  "email_events",
  {
    id: id(),
    emailId: text("email_id").notNull().references(() => emailMessages.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    detail: text("detail"),
    createdAt: created(),
  },
  (t) => [index("email_events_email_idx").on(t.emailId)],
);

/** Messages imported (read-only) from the connected mailbox. */
export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: id(),
    mailbox: text("mailbox").notNull(),
    uidValidity: text("uid_validity").notNull(),
    uid: integer("uid").notNull(),
    messageId: text("message_id").notNull(), // real Message-ID, or "sha256:<hash>" when missing
    fromEmail: text("from_email"),
    fromName: text("from_name"),
    toList: text("to_list"),
    subject: text("subject"),
    sentAt: ts("sent_at"),
    inReplyTo: text("in_reply_to"),
    references: text("references_hdr"),
    textBody: text("text_body"),
    rawSource: text("raw_source").notNull(), // original RFC 822 source, preserved verbatim
    kind: text("kind").notNull().default("reply"), // reply | bounce | auto_reply
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    matchedBy: text("matched_by"), // in-reply-to | references | bounce | sender
    relatedEmailId: text("related_email_id"),
    importedAt: ts("imported_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inbound_msgid_uq").on(t.messageId),
    uniqueIndex("inbound_uid_uq").on(t.mailbox, t.uidValidity, t.uid),
    index("inbound_doc_idx").on(t.documentId),
  ],
);

/** Fields placed on the PDF. Coordinates are fractions (0..1) of the displayed page, origin top-left. */
export const fields = pgTable(
  "fields",
  {
    id: id(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id").notNull().references(() => recipients.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // signature | initials | name | date | text | email | checkbox
    page: integer("page").notNull(), // 0-based
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    w: doublePrecision("w").notNull(),
    h: doublePrecision("h").notNull(),
    required: boolean("required").notNull().default(true),
    label: text("label"),
    placeholder: text("placeholder"),
    defaultValue: text("default_value"),
    options: text("options"), // JSON { dateFormat?, fontSize?, maxLength? }
    value: text("value"),
    valueImage: bytea("value_image"), // PNG for signature / initials (encrypted at rest)
    filledAt: ts("filled_at"),
    createdAt: created(),
  },
  (t) => [index("fields_doc_idx").on(t.documentId), index("fields_recipient_idx").on(t.recipientId)],
);

/** Reusable prepared documents: PDF + recipient roles + field layout. */
export const templates = pgTable(
  "templates",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    message: text("message"),
    fileName: text("file_name").notNull(),
    fileData: bytea("file_data").notNull(),
    fileSha256: text("file_sha256").notNull(),
    pageCount: integer("page_count").notNull(),
    pageInfo: text("page_info").notNull(),
    signingOrder: text("signing_order").notNull().default("parallel"),
    roles: text("roles").notNull(), // JSON [{ key, label, color, order, name?, email? }]
    fieldsJson: text("fields_json").notNull(), // JSON [{ roleKey, type, page, x, y, w, h, required, label, placeholder, defaultValue, options }]
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: ts("last_used_at"),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("templates_org_idx").on(t.orgId)],
);

/** Keys for the CRM / integration API. Only a SHA-256 of the key is stored. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_org_idx").on(t.orgId)],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secretEnc: text("secret_enc").notNull(),
    events: text("events").notNull().default("*"), // comma separated, or *
    active: boolean("active").notNull().default(true),
    createdAt: created(),
  },
  (t) => [index("webhook_endpoints_org_idx").on(t.orgId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    endpointId: text("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    event: text("event").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull().default("queued"), // queued | sending | sent | retrying | failed
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    lastError: text("last_error"),
    responseCode: integer("response_code"),
    deliveredAt: ts("delivered_at"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("webhook_deliveries_idem_uq").on(t.idempotencyKey), index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt)],
);

/** Append-only, hash-chained audit log for each document. */
export const documentEvents = pgTable(
  "document_events",
  {
    id: id(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    detail: text("detail"),
    createdAt: created(),
    // v2
    seq: integer("seq"),
    actor: text("actor"),
    recipientId: text("recipient_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    prevHash: text("prev_hash"),
    hash: text("hash"),
  },
  (t) => [index("document_events_doc_idx").on(t.documentId), uniqueIndex("document_events_seq_uq").on(t.documentId, t.seq)],
);

/** Leases so overlapping cron/worker runs never process the same job type at once. */
export const jobLocks = pgTable("job_locks", {
  name: text("name").primaryKey(),
  lockedAt: ts("locked_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
});

export type EmailSettings = typeof emailSettings.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Recipient = typeof recipients.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;
export type InboundEmail = typeof inboundEmails.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Field = typeof fields.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

