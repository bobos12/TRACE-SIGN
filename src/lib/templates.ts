// Reusable templates: the original PDF + recipient roles + the full field layout.
// Using a template copies everything into a new draft; only names and emails are needed.

import { randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "./db";
import type { Template } from "./schema";
import { openBlob, sealBlob, sha256Hex } from "./crypto";
import { inspectPdf } from "./pdf";
import { RECIPIENT_COLORS, type PageInfo } from "./geometry";
import { createDraft, draftInput, fieldOptionsInput, fieldsOf, getDocument, normalizeLayout, recipientsOf, saveDraft, sendDocument, type Actor } from "./documents";
import { badRequest, notFound } from "./errors";

const newId = () => randomUUID().replace(/-/g, "");

export interface TemplateRole {
  key: string;
  label: string;
  color: string;
  order: number;
  name?: string | null;
  email?: string | null;
}

export interface TemplateField {
  id: string;
  roleKey: string;
  type: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  label?: string | null;
  placeholder?: string | null;
  defaultValue?: string | null;
  options?: z.infer<typeof fieldOptionsInput>;
}

export function rolesOf(tpl: Pick<Template, "roles">): TemplateRole[] {
  return JSON.parse(tpl.roles) as TemplateRole[];
}
export function templateFieldsOf(tpl: Pick<Template, "fieldsJson">): TemplateField[] {
  return JSON.parse(tpl.fieldsJson) as TemplateField[];
}

export async function getTemplate(id: string, orgId: string): Promise<Template> {
  const [tpl] = await db.select().from(t.templates).where(and(eq(t.templates.id, id), eq(t.templates.orgId, orgId)));
  if (!tpl) throw notFound("Template");
  return tpl;
}

export async function listTemplates(orgId: string) {
  return db
    .select({
      id: t.templates.id,
      name: t.templates.name,
      description: t.templates.description,
      fileName: t.templates.fileName,
      pageCount: t.templates.pageCount,
      roles: t.templates.roles,
      fieldsJson: t.templates.fieldsJson,
      signingOrder: t.templates.signingOrder,
      useCount: t.templates.useCount,
      lastUsedAt: t.templates.lastUsedAt,
      updatedAt: t.templates.updatedAt,
    })
    .from(t.templates)
    .where(eq(t.templates.orgId, orgId))
    .orderBy(desc(t.templates.updatedAt));
}

/** New, empty template from an uploaded PDF (fields are placed in the editor). */
export async function createTemplateFromUpload(orgId: string, file: Buffer, fileName: string, name?: string) {
  const info = await inspectPdf(file);
  const [tpl] = await db
    .insert(t.templates)
    .values({
      orgId,
      name: (name?.trim() || fileName.replace(/\.pdf$/i, "") || "Untitled template").slice(0, 200),
      fileName: fileName.slice(0, 200),
      fileData: sealBlob(file),
      fileSha256: sha256Hex(file),
      pageCount: info.pageCount,
      pageInfo: JSON.stringify(info.pages),
      roles: JSON.stringify([{ key: newId(), label: "Signer 1", color: RECIPIENT_COLORS[0], order: 1 }] satisfies TemplateRole[]),
      fieldsJson: "[]",
    })
    .returning();
  return tpl;
}

/** Saves a prepared document (draft or sent) as a template. Signer names/emails become optional defaults. */
export async function createTemplateFromDocument(documentId: string, orgId: string, name: string, keepPeople: boolean) {
  const doc = await getDocument(documentId, orgId);
  const recs = await recipientsOf(documentId);
  const fields = await fieldsOf(documentId);
  if (!recs.length) throw badRequest("Add at least one recipient before saving as a template.");
  const roles: TemplateRole[] = recs.map((r, i) => ({
    key: r.id,
    label: r.roleLabel || `Signer ${i + 1}`,
    color: r.color,
    order: r.routingOrder,
    name: keepPeople ? r.name : null,
    email: keepPeople ? r.email : null,
  }));
  const tfields: TemplateField[] = fields.map((f) => ({
    id: f.id,
    roleKey: f.recipientId,
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
  }));
  const [tpl] = await db
    .insert(t.templates)
    .values({
      orgId,
      name: name.trim().slice(0, 200) || doc.title,
      message: doc.message,
      fileName: doc.fileName,
      fileData: doc.fileData, // already encrypted
      fileSha256: doc.fileSha256,
      pageCount: doc.pageCount ?? 0,
      pageInfo: doc.pageInfo ?? "[]",
      signingOrder: doc.signingOrder,
      roles: JSON.stringify(roles),
      fieldsJson: JSON.stringify(tfields),
    })
    .returning();
  return tpl;
}

export const templateInput = draftInput.extend({ description: z.string().max(500).nullish() });

/** Saves the template editor's state (same shape as a draft; recipients are roles). */
export async function saveTemplate(id: string, orgId: string, input: z.infer<typeof templateInput>) {
  const tpl = await getTemplate(id, orgId);
  const pages = JSON.parse(tpl.pageInfo) as PageInfo[];
  const fields = normalizeLayout(pages, input.recipients, input.fields);
  const roles: TemplateRole[] = input.recipients.map((r, i) => ({
    key: r.id,
    label: r.roleLabel || r.name || `Signer ${i + 1}`,
    color: r.color ?? RECIPIENT_COLORS[i % RECIPIENT_COLORS.length],
    order: r.order,
    name: r.name || null,
    email: r.email || null,
  }));
  await db
    .update(t.templates)
    .set({
      name: input.title,
      description: input.description ?? tpl.description,
      message: input.message?.trim() || null,
      signingOrder: input.signingOrder,
      roles: JSON.stringify(roles),
      fieldsJson: JSON.stringify(
        fields.map((f) => ({
          id: f.id,
          roleKey: f.recipientId,
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
          options: f.options,
        })),
      ),
      updatedAt: new Date(),
    })
    .where(and(eq(t.templates.id, id), eq(t.templates.orgId, orgId)));
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function deleteTemplate(id: string, orgId: string) {
  await getTemplate(id, orgId);
  await db.delete(t.templates).where(and(eq(t.templates.id, id), eq(t.templates.orgId, orgId)));
}

export const useTemplateInput = z.object({
  title: z.string().trim().max(200).optional(),
  message: z.string().max(2000).nullish(),
  recipients: z.record(z.string(), z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email() })),
  send: z.boolean().default(false),
  externalRef: z.string().max(200).nullish(),
});

/** Creates a draft (and optionally sends it) from a template: only names and emails are needed. */
export async function createFromTemplate(
  templateId: string,
  orgId: string,
  sender: { userId: string; email: string; name: string },
  input: z.infer<typeof useTemplateInput>,
  actor: Actor,
  source: "template" | "api" = "template",
) {
  const tpl = await getTemplate(templateId, orgId);
  const roles = rolesOf(tpl);
  const missing = roles.filter((r) => !input.recipients[r.key] && !(r.name && r.email));
  if (missing.length) throw badRequest(`Enter a name and email for: ${missing.map((r) => r.label).join(", ")}.`);

  const doc = await createDraft(
    {
      orgId,
      createdBy: sender.userId,
      senderEmail: sender.email,
      senderName: sender.name,
      file: openBlob(tpl.fileData)!,
      fileName: tpl.fileName,
      title: input.title || tpl.name,
      source,
      templateId: tpl.id,
      externalRef: input.externalRef ?? null,
    },
    actor,
  );
  // Fresh ids for the new document; role keys map onto new recipient ids.
  const idFor = new Map(roles.map((r) => [r.key, newId()]));
  await saveDraft(doc.id, orgId, {
    title: doc.title,
    message: input.message ?? tpl.message,
    signingOrder: tpl.signingOrder as "parallel" | "sequential",
    expiresInDays: doc.expiresInDays,
    reminderEveryDays: doc.reminderEveryDays,
    maxReminders: doc.maxReminders,
    recipients: roles.map((r) => {
      const p = input.recipients[r.key] ?? { name: r.name ?? "", email: r.email ?? "" };
      return { id: idFor.get(r.key)!, name: p.name, email: p.email.toLowerCase(), roleLabel: r.label, color: r.color, order: r.order };
    }),
    fields: templateFieldsOf(tpl).map((f) => ({
      id: newId(),
      recipientId: idFor.get(f.roleKey)!,
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      required: f.required,
      label: f.label ?? null,
      placeholder: f.placeholder ?? null,
      defaultValue: f.defaultValue ?? null,
      options: f.options ?? {},
    })),
  });
  await db
    .update(t.templates)
    .set({ useCount: sql`${t.templates.useCount} + 1`, lastUsedAt: new Date() })
    .where(eq(t.templates.id, tpl.id));
  if (input.send) return sendDocument(doc.id, orgId, actor);
  return getDocument(doc.id, orgId);
}
