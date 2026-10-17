import { userRoute } from "@/lib/api";
import { deleteTemplate, getTemplate, rolesOf, saveTemplate, templateFieldsOf, templateInput } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, { params }, user) => {
  const tpl = await getTemplate(params.id, user.orgId);
  return {
    document: {
      id: tpl.id,
      title: tpl.name,
      description: tpl.description,
      message: tpl.message,
      status: "template",
      signingOrder: tpl.signingOrder,
      expiresInDays: 30,
      reminderEveryDays: 3,
      maxReminders: 3,
      pageCount: tpl.pageCount,
      pages: JSON.parse(tpl.pageInfo),
      fileName: tpl.fileName,
    },
    recipients: rolesOf(tpl).map((r) => ({ id: r.key, name: r.name ?? "", email: r.email ?? "", roleLabel: r.label, color: r.color, order: r.order, status: "pending" })),
    fields: templateFieldsOf(tpl).map((f) => ({ ...f, recipientId: f.roleKey, options: f.options ?? {} })),
  };
});

export const PUT = userRoute(async (req, { params }, user) => saveTemplate(params.id, user.orgId, templateInput.parse(await req.json())));

export const DELETE = userRoute(async (_req, { params }, user) => {
  await deleteTemplate(params.id, user.orgId);
  return { ok: true };
});
