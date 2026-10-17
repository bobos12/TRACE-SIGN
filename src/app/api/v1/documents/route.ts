import { and, desc, eq } from "drizzle-orm";
import { apiKeyRoute, kickOutbox } from "@/lib/api";
import { db, t } from "@/lib/db";
import { createDraft, getDocument, MAX_PDF_BYTES, saveDraft, sendDocument } from "@/lib/documents";
import { getOrg } from "@/lib/org";
import { env } from "@/lib/env";
import { badRequest } from "@/lib/errors";
import { documentJson, toDraft, v1CreateInput } from "@/lib/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/v1/documents?status=&externalRef=&limit= */
export const GET = apiKeyRoute(async (req, _ctx, c) => {
  const q = new URL(req.url).searchParams;
  const conds = [eq(t.documents.orgId, c.orgId)];
  if (q.get("status")) conds.push(eq(t.documents.status, q.get("status")!));
  if (q.get("externalRef")) conds.push(eq(t.documents.externalRef, q.get("externalRef")!));
  const rows = await db
    .select({ id: t.documents.id, title: t.documents.title, status: t.documents.status, externalRef: t.documents.externalRef, createdAt: t.documents.createdAt, sentAt: t.documents.sentAt, completedAt: t.documents.completedAt })
    .from(t.documents)
    .where(and(...conds))
    .orderBy(desc(t.documents.createdAt))
    .limit(Math.min(200, Number(q.get("limit") || 50)));
  return { data: rows };
});

/**
 * POST /api/v1/documents
 *   multipart/form-data: file=<PDF>, data=<JSON>
 *   or application/json: { ...data, file: { name, base64 } }
 */
export const POST = apiKeyRoute(async (req, _ctx, c) => {
  let file: Buffer;
  let fileName = "document.pdf";
  let raw: unknown;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw badRequest("Send the PDF as the 'file' part.");
    if (f.size > MAX_PDF_BYTES) throw badRequest("PDF is too large.");
    file = Buffer.from(await f.arrayBuffer());
    fileName = f.name || fileName;
    raw = JSON.parse(String(form.get("data") ?? "{}"));
  } else {
    const body = (await req.json()) as { file?: { name?: string; base64?: string } };
    if (!body.file?.base64) throw badRequest("Include file.base64 (the PDF) or send multipart/form-data.");
    file = Buffer.from(body.file.base64, "base64");
    fileName = body.file.name || fileName;
    raw = body;
  }
  const input = v1CreateInput.parse(raw);
  const org = await getOrg(c.orgId);
  const actor = { label: `api:${c.prefix}`, ip: req.headers.get("x-forwarded-for")?.split(",")[0] ?? null, userAgent: req.headers.get("user-agent") };
  const doc = await createDraft(
    {
      orgId: c.orgId,
      createdBy: `api:${c.keyId}`,
      senderEmail: input.sender.email ?? (c.orgId === "default" ? env.adminEmail() : ""),
      senderName: input.sender.name ?? org.name,
      file,
      fileName,
      title: input.title,
      source: "api",
      externalRef: input.externalRef ?? null,
    },
    actor,
  );
  const pages = JSON.parse(doc.pageInfo ?? "[]");
  const { recipients, fields } = toDraft(input, pages);
  await saveDraft(doc.id, c.orgId, {
    title: input.title,
    message: input.message,
    signingOrder: input.signingOrder,
    expiresInDays: input.expiresInDays,
    reminderEveryDays: input.reminderEveryDays,
    maxReminders: 3,
    recipients,
    fields,
  });
  if (input.send) {
    await sendDocument(doc.id, c.orgId, actor);
    await kickOutbox();
  }
  return new Response(JSON.stringify(await documentJson(await getDocument(doc.id, c.orgId))), { status: 201, headers: { "Content-Type": "application/json" } });
});
