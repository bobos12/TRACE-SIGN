import { Users } from "lucide-react";
import { requireUserPage } from "@/lib/auth";
import { listContacts } from "@/lib/queries";
import { ContactsTable } from "./ContactsTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contacts" };

export default async function ContactsPage() {
  const user = await requireUserPage();
  const rows = await listContacts(user.orgId);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <p>Everyone you&apos;ve sent documents to, built from your signing history.</p>
        </div>
      </div>
      <ContactsTable rows={rows.map((r) => ({ ...r, lastAt: new Date(r.lastAt).toISOString() }))} empty={<Users size={20} />} />
    </>
  );
}
