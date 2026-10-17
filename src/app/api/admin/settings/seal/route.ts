import { userRoute } from "@/lib/api";
import { getOrg, sealIdentity, setSealIdentity } from "@/lib/org";
import { describeCert, readP12 } from "@/lib/seal";
import { badRequest } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, _ctx, user) => {
  const org = await getOrg(user.orgId);
  const id = await sealIdentity(org);
  return describeCert(id.certPem);
}, { manage: true });

/** Upload a document-signing certificate (PKCS#12 / .p12 / .pfx with its private key). */
export const POST = userRoute(async (req, _ctx, user) => {
  const form = await req.formData();
  const file = form.get("file");
  const pass = String(form.get("passphrase") ?? "");
  if (!(file instanceof File)) throw badRequest("Choose a .p12 or .pfx file.");
  if (file.size > 64 * 1024) throw badRequest("Certificate file is too large.");
  const p12 = Buffer.from(await file.arrayBuffer());
  const info = readP12(p12, pass);
  await setSealIdentity(user.orgId, { p12, passphrase: pass, certPem: info.certPem });
  return describeCert(info.certPem);
}, { manage: true });

/** Remove an uploaded certificate; a new self-signed workspace seal is generated on next use. */
export const DELETE = userRoute(async (_req, _ctx, user) => {
  await setSealIdentity(user.orgId, null);
  return { ok: true };
}, { manage: true });
