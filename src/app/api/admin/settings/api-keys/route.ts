import { z } from "zod";
import { userRoute } from "@/lib/api";
import { db, t } from "@/lib/db";
import { newApiKey } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Creates an API key. The full key is returned once and only its SHA-256 is stored. */
export const POST = userRoute(async (req, _ctx, user) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await req.json());
  const k = newApiKey();
  const [row] = await db.insert(t.apiKeys).values({ orgId: user.orgId, name, prefix: k.prefix, keyHash: k.hash }).returning();
  return { id: row.id, key: k.key, prefix: k.prefix };
}, { manage: true });
