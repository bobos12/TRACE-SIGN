import { kickOutbox, userRoute } from "@/lib/api";
import { finishCompletedDocument, getDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Retry generating the signed PDF + audit trail if it failed earlier. */
export const POST = userRoute(async (_req, { params }, user) => {
  await getDocument(params.id, user.orgId);
  await finishCompletedDocument(params.id);
  await kickOutbox();
  return { ok: true };
});
