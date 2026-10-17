import { actorFrom, kickOutbox, userRoute } from "@/lib/api";
import { createFromTemplate, useTemplateInput } from "@/lib/templates";
import { getOrg } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = userRoute(async (req, { params }, user) => {
  const input = useTemplateInput.parse(await req.json());
  const org = await getOrg(user.orgId);
  const doc = await createFromTemplate(
    params.id,
    user.orgId,
    { userId: user.userId, email: user.email, name: user.name && user.name !== "Owner" ? user.name : org.name },
    input,
    actorFrom(req, `sender:${user.email}`),
  );
  if (input.send) await kickOutbox();
  return { id: doc.id, status: doc.status };
});
