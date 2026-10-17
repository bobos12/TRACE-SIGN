import { apiKeyRoute, kickOutbox } from "@/lib/api";
import { getDocument, voidDocument } from "@/lib/documents";
import { documentJson } from "@/lib/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = apiKeyRoute(async (req, { params }, c) => {
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  await voidDocument(params.id, c.orgId, String(body.reason ?? "").slice(0, 500), { label: `api:${c.prefix}`, ip: req.headers.get("x-forwarded-for"), userAgent: req.headers.get("user-agent") });
  await kickOutbox();
  return documentJson(await getDocument(params.id, c.orgId));
});
