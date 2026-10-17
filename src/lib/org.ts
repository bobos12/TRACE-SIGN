import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "./db";
import type { Organization } from "./schema";
import { DATE_FORMATS } from "./geometry";
import { generateSealIdentity, packIdentity, unpackIdentity, type SealIdentity } from "./seal";

export const DEFAULT_ORG = "default";

export async function getOrg(orgId: string = DEFAULT_ORG): Promise<Organization> {
  const [o] = await db.select().from(t.organizations).where(eq(t.organizations.id, orgId));
  if (o) return o;
  if (orgId !== DEFAULT_ORG) throw new Error("Workspace not found.");
  const [created] = await db
    .insert(t.organizations)
    .values({ id: DEFAULT_ORG, name: "TRACE.STUDIO", brandName: "TRACE.SIGN" })
    .onConflictDoNothing()
    .returning();
  return created ?? (await getOrg(orgId));
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export const brandingInput = z.object({
  name: z.string().trim().min(1).max(120),
  brandName: z.string().trim().min(1).max(60),
  accentColor: z.string().regex(HEX, "Use a hex colour like #FF5A33"),
  emailFromName: z.string().trim().max(80).optional().nullable(),
  timezone: z.string().trim().min(1).max(64),
  dateFormat: z.enum(DATE_FORMATS),
  completionDelivery: z.enum(["attachment", "link"]),
  attachAuditToEmail: z.boolean(),
  sealPdf: z.boolean(),
  retentionDays: z.coerce.number().int().min(0).max(3650),
});

export async function updateOrg(orgId: string, input: z.infer<typeof brandingInput>) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    throw new Error(`Unknown time zone "${input.timezone}". Use an IANA name such as America/Los_Angeles.`);
  }
  await db
    .update(t.organizations)
    .set({ ...input, emailFromName: input.emailFromName || null, updatedAt: new Date() })
    .where(eq(t.organizations.id, orgId));
}

export async function setOrgLogo(orgId: string, png: Buffer | null) {
  if (png) {
    if (png.length > 512 * 1024) throw new Error("Logo must be under 512 KB.");
    if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error("Logo must be a PNG image.");
  }
  await db.update(t.organizations).set({ logoPng: png, updatedAt: new Date() }).where(eq(t.organizations.id, orgId));
}

/** The workspace's sealing identity; generated on first use. */
export async function sealIdentity(org: Organization): Promise<SealIdentity> {
  if (org.sealP12Enc && org.sealCertPem) return unpackIdentity(org.sealP12Enc, org.sealCertPem);
  const id = generateSealIdentity(`${org.brandName} Document Seal`, org.name);
  await db
    .update(t.organizations)
    .set({ sealP12Enc: packIdentity(id), sealCertPem: id.certPem, updatedAt: new Date() })
    .where(eq(t.organizations.id, org.id));
  return id;
}

export async function setSealIdentity(orgId: string, id: SealIdentity | null) {
  await db
    .update(t.organizations)
    .set({ sealP12Enc: id ? packIdentity(id) : null, sealCertPem: id?.certPem ?? null, updatedAt: new Date() })
    .where(eq(t.organizations.id, orgId));
}

/** Branding passed to email templates and public pages. */
export interface Brand {
  name: string; // product name shown to recipients, e.g. "TRACE.SIGN" or "TRAVIS BAIL.SIGN"
  company: string;
  accent: string;
  hasLogo: boolean;
  orgId: string;
}

export function brandOf(o: Organization): Brand {
  return { name: o.brandName, company: o.name, accent: o.accentColor, hasLogo: !!o.logoPng, orgId: o.id };
}
