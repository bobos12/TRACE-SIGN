import { actorFrom, kickOutbox, userRoute } from "@/lib/api";
import { recipientsOf, sendDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = userRoute(async (req, { params }, user) => {
  const doc = await sendDocument(params.id, user.orgId, actorFrom(req, `sender:${user.email}`));
  await kickOutbox();
  const me = (await recipientsOf(doc.id)).find((r) => r.email === user.email && (r.status === "sent" || r.status === "opened"));
  return { ok: true, id: doc.id, signNow: me ? `/api/admin/documents/${doc.id}/sign-now` : null };
});
