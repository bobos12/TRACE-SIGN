import { userRoute } from "@/lib/api";
import { setOrgLogo } from "@/lib/org";
import { badRequest } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = userRoute(async (req, _ctx, user) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a PNG logo.");
  await setOrgLogo(user.orgId, Buffer.from(await file.arrayBuffer()));
  return { ok: true };
}, { manage: true });

export const DELETE = userRoute(async (_req, _ctx, user) => {
  await setOrgLogo(user.orgId, null);
  return { ok: true };
}, { manage: true });
