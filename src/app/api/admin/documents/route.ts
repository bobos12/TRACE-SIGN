import { actorFrom, userRoute } from "@/lib/api";
import { createDraft, MAX_PDF_BYTES } from "@/lib/documents";
import { getOrg } from "@/lib/org";
import { badRequest } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Upload a PDF → new draft, opened in the editor. */
export const POST = userRoute(async (req, _ctx, user) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a PDF to upload.");
  if (file.size > MAX_PDF_BYTES) throw badRequest(`PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
  const org = await getOrg(user.orgId);
  const doc = await createDraft(
    {
      orgId: user.orgId,
      createdBy: user.userId,
      senderEmail: user.email,
      senderName: user.name && user.name !== "Owner" ? user.name : org.name,
      file: Buffer.from(await file.arrayBuffer()),
      fileName: file.name.slice(0, 200) || "document.pdf",
      title: String(form.get("title") ?? ""),
    },
    actorFrom(req, `sender:${user.email}`),
  );
  return { id: doc.id };
});
