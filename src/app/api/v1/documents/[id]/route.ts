import { apiKeyRoute } from "@/lib/api";
import { getDocument } from "@/lib/documents";
import { documentJson } from "@/lib/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiKeyRoute(async (_req, { params }, c) => documentJson(await getDocument(params.id, c.orgId)));
