import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUserPage, canManage } from "@/lib/auth";
import { getOrg, sealIdentity } from "@/lib/org";
import { describeCert } from "@/lib/seal";
import { db, t } from "@/lib/db";
import { env, appUrl } from "@/lib/env";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { BrandingForm, DevelopersPanel, SecurityPanel, TeamPanel } from "./SettingsForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const TABS = [
  ["general", "Workspace & branding"],
  ["security", "Security & delivery"],
  ["developers", "API & webhooks"],
  ["team", "Team"],
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const user = await requireUserPage();
  const tab = TABS.some(([k]) => k === searchParams.tab) ? searchParams.tab! : "general";
  const org = await getOrg(user.orgId);
  const manage = canManage(user);

  let body: React.ReactNode = null;
  if (tab === "general") {
    body = (
      <BrandingForm
        disabled={!manage}
        org={{ id: org.id, name: org.name, brandName: org.brandName, accentColor: org.accentColor, emailFromName: org.emailFromName, timezone: org.timezone, dateFormat: org.dateFormat, completionDelivery: org.completionDelivery, attachAuditToEmail: org.attachAuditToEmail, sealPdf: org.sealPdf, retentionDays: org.retentionDays, hasLogo: !!org.logoPng }}
      />
    );
  } else if (tab === "security") {
    const cert = manage ? describeCert((await sealIdentity(org)).certPem) : null;
    body = (
      <SecurityPanel
        disabled={!manage}
        cert={cert}
        org={{ id: org.id, name: org.name, brandName: org.brandName, accentColor: org.accentColor, emailFromName: org.emailFromName, timezone: org.timezone, dateFormat: org.dateFormat, completionDelivery: org.completionDelivery, attachAuditToEmail: org.attachAuditToEmail, sealPdf: org.sealPdf, retentionDays: org.retentionDays, hasLogo: !!org.logoPng }}
      />
    );
  } else if (tab === "developers") {
    const [keys, hooks, deliveries] = await Promise.all([
      db.select().from(t.apiKeys).where(eq(t.apiKeys.orgId, user.orgId)).orderBy(desc(t.apiKeys.createdAt)),
      db.select().from(t.webhookEndpoints).where(eq(t.webhookEndpoints.orgId, user.orgId)).orderBy(desc(t.webhookEndpoints.createdAt)),
      db
        .select({ d: t.webhookDeliveries, url: t.webhookEndpoints.url })
        .from(t.webhookDeliveries)
        .innerJoin(t.webhookEndpoints, eq(t.webhookDeliveries.endpointId, t.webhookEndpoints.id))
        .where(eq(t.webhookEndpoints.orgId, user.orgId))
        .orderBy(desc(t.webhookDeliveries.createdAt))
        .limit(15),
    ]);
    body = (
      <DevelopersPanel
        disabled={!manage}
        baseUrl={appUrl()}
        events={[...WEBHOOK_EVENTS]}
        keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() }))}
        hooks={hooks.map((h) => ({ id: h.id, url: h.url, events: h.events, active: h.active, createdAt: h.createdAt.toISOString() }))}
        deliveries={deliveries.map(({ d, url }) => ({ id: d.id, event: d.event, url, status: d.status, attempts: d.attempts, code: d.responseCode, error: d.lastError, at: d.createdAt.toISOString() }))}
      />
    );
  } else {
    const members = await db.select().from(t.users).where(eq(t.users.orgId, user.orgId)).orderBy(desc(t.users.createdAt));
    body = (
      <TeamPanel
        disabled={!manage}
        me={user.userId}
        owner={user.orgId === "default" ? env.adminEmail() : null}
        members={members.map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role, lastLoginAt: m.lastLoginAt?.toISOString() ?? null, disabled: !!m.disabledAt }))}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>{org.name} workspace{!manage && " · view only (ask an admin to make changes)"}</p>
        </div>
      </div>
      <nav className="tabs">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/admin/settings?tab=${k}`} className={tab === k ? "on" : ""}>
            {l}
          </Link>
        ))}
        <Link href="/admin/email">Email delivery ↗</Link>
      </nav>
      {body}
    </>
  );
}
