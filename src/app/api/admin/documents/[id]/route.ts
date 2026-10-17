import { userRoute, canManageUser } from "@/lib/api";
import { deleteDocument, draftInput, fieldsOf, getDocument, pagesOf, publicField, recipientsOf, saveDraft } from "@/lib/documents";
import { forbidden } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Editor state. */
export const GET = userRoute(async (_req, { params }, user) => {
  const d = await getDocument(params.id, user.orgId);
  const [recs, fields] = await Promise.all([recipientsOf(d.id), fieldsOf(d.id)]);
  return {
    document: {
      id: d.id,
      title: d.title,
      message: d.message,
      status: d.status,
      signingOrder: d.signingOrder,
      expiresInDays: d.expiresInDays,
      reminderEveryDays: d.reminderEveryDays,
      maxReminders: d.maxReminders,
      pageCount: d.pageCount,
      pages: pagesOf(d),
      fileName: d.fileName,
    },
    recipients: recs.map((r) => ({ id: r.id, name: r.name, email: r.email, roleLabel: r.roleLabel, color: r.color, order: r.routingOrder, status: r.status })),
    fields: fields.map(publicField),
  };
});

export const PUT = userRoute(async (req, { params }, user) => saveDraft(params.id, user.orgId, draftInput.parse(await req.json())));

export const DELETE = userRoute(async (_req, { params }, user) => {
  const d = await getDocument(params.id, user.orgId);
  if (d.status !== "draft" && !canManageUser(user)) throw forbidden("Only admins can delete sent documents.");
  await deleteDocument(params.id, user.orgId);
  return { ok: true };
});
