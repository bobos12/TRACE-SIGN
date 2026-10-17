import { and, eq } from "drizzle-orm";
import { userRoute } from "@/lib/api";
import { db, t } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = userRoute(async (_req, { params }, user) => {
  await db.delete(t.webhookEndpoints).where(and(eq(t.webhookEndpoints.id, params.id), eq(t.webhookEndpoints.orgId, user.orgId)));
  return { ok: true };
}, { manage: true });
