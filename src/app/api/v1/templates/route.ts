import { apiKeyRoute } from "@/lib/api";
import { listTemplates } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiKeyRoute(async (_req, _ctx, c) => {
  const rows = await listTemplates(c.orgId);
  return {
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      pageCount: r.pageCount,
      signingOrder: r.signingOrder,
      roles: (JSON.parse(r.roles) as { key: string; label: string; order: number }[]).map((x) => ({ key: x.key, label: x.label, order: x.order })),
      fieldCount: (JSON.parse(r.fieldsJson) as unknown[]).length,
      updatedAt: r.updatedAt,
    })),
  };
});
