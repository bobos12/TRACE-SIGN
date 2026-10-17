import { requireUserPage } from "@/lib/auth";
import { listTemplates } from "@/lib/templates";
import { TemplatesClient } from "./TemplatesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Templates" };

export default async function TemplatesPage({ searchParams }: { searchParams: { use?: string } }) {
  const user = await requireUserPage();
  const rows = await listTemplates(user.orgId);
  return (
    <TemplatesClient
      openUse={searchParams.use ?? null}
      templates={rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        pageCount: r.pageCount,
        signingOrder: r.signingOrder,
        roles: JSON.parse(r.roles) as { key: string; label: string; color: string; order: number; name?: string | null; email?: string | null }[],
        fieldCount: (JSON.parse(r.fieldsJson) as unknown[]).length,
        useCount: r.useCount,
        updatedAt: r.updatedAt.toISOString(),
      }))}
    />
  );
}
