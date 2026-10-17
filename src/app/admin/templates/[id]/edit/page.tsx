import { requireUserPage } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { Editor } from "@/components/editor/Editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit template" };

export default async function EditTemplate({ params }: { params: { id: string } }) {
  const user = await requireUserPage();
  const org = await getOrg(user.orgId);
  return <Editor mode="template" id={params.id} me={{ name: user.name === "Owner" ? org.name : user.name, email: user.email }} defaultDateFormat={org.dateFormat} timeZone={org.timezone} />;
}
