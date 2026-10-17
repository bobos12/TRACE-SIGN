import { apiKeyRoute, kickOutbox } from "@/lib/api";
import { createFromTemplate, useTemplateInput } from "@/lib/templates";
import { getOrg } from "@/lib/org";
import { env } from "@/lib/env";
import { documentJson } from "@/lib/v1";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/v1/templates/:id/documents  { recipients: { <roleKey>: { name, email } }, send, title?, externalRef? } */
export const POST = apiKeyRoute(async (req, { params }, c) => {
  const raw = (await req.json()) as Record<string, unknown>;
  const input = useTemplateInput.parse(raw);
  const sender = z.object({ name: z.string().max(100).optional(), email: z.string().email().optional() }).default({}).parse(raw.sender);
  const org = await getOrg(c.orgId);
  const doc = await createFromTemplate(
    params.id,
    c.orgId,
    { userId: `api:${c.keyId}`, email: sender.email ?? (c.orgId === "default" ? env.adminEmail() : ""), name: sender.name ?? org.name },
    input,
    { label: `api:${c.prefix}`, ip: req.headers.get("x-forwarded-for"), userAgent: req.headers.get("user-agent") },
    "api",
  );
  if (input.send) await kickOutbox();
  return new Response(JSON.stringify(await documentJson(doc)), { status: 201, headers: { "Content-Type": "application/json" } });
});
