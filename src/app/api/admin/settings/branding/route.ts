import { userRoute } from "@/lib/api";
import { brandingInput, updateOrg } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = userRoute(async (req, _ctx, user) => {
  await updateOrg(user.orgId, brandingInput.parse(await req.json()));
  return { ok: true };
}, { manage: true });
