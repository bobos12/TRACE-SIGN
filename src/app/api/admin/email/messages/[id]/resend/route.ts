import { adminRoute, kickOutbox } from "@/lib/api";
import { requeueEmail } from "@/lib/mail/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminRoute(async (_req, { params }) => {
  await requeueEmail(params.id);
  return { ok: true, outbox: await kickOutbox() };
});
