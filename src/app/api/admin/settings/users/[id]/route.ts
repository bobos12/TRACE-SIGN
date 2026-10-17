import { and, eq } from "drizzle-orm";
import { userRoute } from "@/lib/api";
import { db, t } from "@/lib/db";
import { badRequest } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Disables a member (keeps their history). */
export const DELETE = userRoute(async (_req, { params }, user) => {
  if (params.id === user.userId) throw badRequest("You can't remove yourself.");
  await db.update(t.users).set({ disabledAt: new Date() }).where(and(eq(t.users.id, params.id), eq(t.users.orgId, user.orgId)));
  return { ok: true };
}, { manage: true });
