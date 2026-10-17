import { userRoute } from "@/lib/api";
import { MAX_PDF_BYTES } from "@/lib/documents";
import { createTemplateFromUpload } from "@/lib/templates";
import { badRequest } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = userRoute(async (req, _ctx, user) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a PDF to upload.");
  if (file.size > MAX_PDF_BYTES) throw badRequest(`PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
  const tpl = await createTemplateFromUpload(user.orgId, Buffer.from(await file.arrayBuffer()), file.name || "template.pdf", String(form.get("name") ?? ""));
  return { id: tpl.id };
});
