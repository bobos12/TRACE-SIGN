import { z } from "zod";
import { actorFrom, kickOutbox, userRoute } from "@/lib/api";
import { voidDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = userRoute(async (req, { params }, user) => {
  const { reason } = z.object({ reason: z.string().max(500).default("") }).parse(await req.json().catch(() => ({})));
  await voidDocument(params.id, user.orgId, reason, actorFrom(req, `sender:${user.email}`));
  await kickOutbox();
  return { ok: true };
});
