// Shapes and helpers for the public integration API (/api/v1).
import { randomUUID } from "crypto";
import { z } from "zod";
import { DEFAULT_SIZE, FIELD_TYPES, RECIPIENT_COLORS, type FieldType, type PageInfo } from "./geometry";
import { fieldOptionsInput, fieldsOf, pagesOf, publicField, recipientsOf } from "./documents";
import type { Document } from "./schema";
import { appUrl } from "./env";
import { badRequest } from "./errors";

const newId = () => randomUUID().replace(/-/g, "");

export const v1CreateInput = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().max(2000).nullish(),
  signingOrder: z.enum(["parallel", "sequential"]).default("parallel"),
  expiresInDays: z.number().int().min(0).max(365).default(30),
  reminderEveryDays: z.number().int().min(0).max(30).default(3),
  externalRef: z.string().max(200).nullish(),
  send: z.boolean().default(false),
  sender: z.object({ name: z.string().trim().max(100).optional(), email: z.string().trim().toLowerCase().email().optional() }).default({}),
  recipients: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().email(),
        role: z.string().trim().max(60).optional(),
        order: z.number().int().min(1).max(50).default(1),
      }),
    )
    .min(1)
    .max(20),
  fields: z
    .array(
      z.object({
        recipient: z.string().min(1),
        type: z.enum(FIELD_TYPES as [FieldType, ...FieldType[]]),
        page: z.number().int().min(1),
        x: z.number().min(0),
        y: z.number().min(0),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        unit: z.enum(["fraction", "pt"]).default("pt"),
        required: z.boolean().default(true),
        label: z.string().max(80).optional(),
        placeholder: z.string().max(120).optional(),
        defaultValue: z.string().max(500).optional(),
        options: fieldOptionsInput,
      }),
    )
    .max(1000)
    .default([]),
});
export type V1CreateInput = z.infer<typeof v1CreateInput>;

/** Converts API fields (1-based pages, points or fractions, top-left origin) into editor fields. */
export function toDraft(input: V1CreateInput, pages: PageInfo[]) {
  const keys = new Map(input.recipients.map((r) => [r.key, newId()]));
  if (keys.size !== input.recipients.length) throw badRequest("Recipient keys must be unique.");
  const recipients = input.recipients.map((r, i) => ({ id: keys.get(r.key)!, name: r.name, email: r.email, roleLabel: r.role ?? null, color: RECIPIENT_COLORS[i % RECIPIENT_COLORS.length], order: r.order }));
  const fields = input.fields.map((f) => {
    const rid = keys.get(f.recipient);
    if (!rid) throw badRequest(`Field refers to unknown recipient key "${f.recipient}".`);
    const p = pages[f.page - 1];
    if (!p) throw badRequest(`Field is on page ${f.page}, but the document has ${pages.length} pages.`);
    const d = DEFAULT_SIZE[f.type];
    const pt = f.unit === "pt";
    const w = f.width ?? (pt ? d.w : d.w / p.w);
    const h = f.height ?? (pt ? d.h : d.h / p.h);
    return {
      id: newId(),
      recipientId: rid,
      type: f.type,
      page: f.page - 1,
      x: pt ? f.x / p.w : f.x,
      y: pt ? f.y / p.h : f.y,
      w: pt ? w / p.w : w,
      h: pt ? h / p.h : h,
      required: f.required,
      label: f.label ?? null,
      placeholder: f.placeholder ?? null,
      defaultValue: f.defaultValue ?? null,
      options: f.options ?? {},
    };
  });
  return { recipients, fields };
}

export async function documentJson(d: Document) {
  const [recs, fields] = await Promise.all([recipientsOf(d.id), fieldsOf(d.id)]);
  const base = appUrl();
  return {
    id: d.id,
    title: d.title,
    status: d.status,
    externalRef: d.externalRef,
    signingOrder: d.signingOrder,
    pageCount: d.pageCount,
    pages: pagesOf(d),
    createdAt: d.createdAt,
    sentAt: d.sentAt,
    expiresAt: d.expiresAt,
    completedAt: d.completedAt,
    originalSha256: d.fileSha256,
    completedSha256: d.completedSha256,
    sealed: d.sealed,
    recipients: recs.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.roleLabel, order: r.routingOrder, status: r.status, invitedAt: r.invitedAt, viewedAt: r.openedAt, signedAt: r.signedAt, declinedAt: r.declinedAt, declineReason: r.declineReason })),
    fields: fields.map((f) => {
      const { value, ...rest } = publicField(f);
      return { ...rest, page: f.page + 1, filled: !!f.filledAt, value: f.type === "signature" || f.type === "initials" ? (value ? "signed" : null) : value };
    }),
    links: {
      self: `${base}/api/v1/documents/${d.id}`,
      signedPdf: d.completedSha256 ? `${base}/api/v1/documents/${d.id}/pdf?which=completed` : null,
      auditTrail: d.auditSha256 ? `${base}/api/v1/documents/${d.id}/pdf?which=audit` : null,
      dashboard: `${base}/admin/documents/${d.id}`,
    },
  };
}
