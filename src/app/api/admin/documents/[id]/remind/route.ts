import { z } from "zod";
import { actorFrom, kickOutbox, userRoute } from "@/lib/api";
import { getDocument, remindAll, sendReminder } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resend the invitation to one recipient, or to everyone still waiting. */
export const POST = userRoute(async (req, { params }, user) => {
  const { recipientId } = z.object({ recipientId: z.string().optional() }).parse(await req.json().catch(() => ({})));
  const actor = actorFrom(req, `sender:${user.email}`);
  await getDocument(params.id, user.orgId);
  const out = recipientId ? (await sendReminder(recipientId, { manual: true, orgId: user.orgId, actor }), { sent: 1 }) : await remindAll(params.id, user.orgId, actor);
  await kickOutbox();
  return out;
});
