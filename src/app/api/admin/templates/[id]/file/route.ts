import { userRoute } from "@/lib/api";
import { getTemplate } from "@/lib/templates";
import { openBlob } from "@/lib/crypto";
import { fileNameFor, pdfResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, { params }, user) => {
  const tpl = await getTemplate(params.id, user.orgId);
  return pdfResponse(openBlob(tpl.fileData)!, fileNameFor(tpl.name));
});
