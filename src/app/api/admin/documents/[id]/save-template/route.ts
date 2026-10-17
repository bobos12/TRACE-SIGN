import { z } from "zod";
import { userRoute } from "@/lib/api";
import { createTemplateFromDocument } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = userRoute(async (req, { params }, user) => {
  const b = z.object({ name: z.string().trim().min(1).max(200), keepPeople: z.boolean().default(false) }).parse(await req.json());
  const tpl = await createTemplateFromDocument(params.id, user.orgId, b.name, b.keepPeople);
  return { id: tpl.id };
});
