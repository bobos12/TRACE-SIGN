import { z } from "zod";
import { userRoute } from "@/lib/api";
import { createEndpoint, WEBHOOK_EVENTS } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = userRoute(async (req, _ctx, user) => {
  const b = z.object({ url: z.string().url().max(500), events: z.array(z.enum(WEBHOOK_EVENTS)).default([]) }).parse(await req.json());
  const { endpoint, secret } = await createEndpoint(user.orgId, b.url, b.events);
  return { id: endpoint.id, secret };
}, { manage: true });
