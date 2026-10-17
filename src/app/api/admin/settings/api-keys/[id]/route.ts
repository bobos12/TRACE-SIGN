import { and, eq } from "drizzle-orm";
import { userRoute } from "@/lib/api";
import { db, t } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = userRoute(async (_req, { params }, user) => {
  await db.update(t.apiKeys).set({ revokedAt: new Date() }).where(and(eq(t.apiKeys.id, params.id), eq(t.apiKeys.orgId, user.orgId)));
  return { ok: true };
}, { manage: true });
