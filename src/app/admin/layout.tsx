import { Suspense } from "react";
import { requireUserPage } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { listDocumentRows, viewCounts } from "@/lib/queries";
import { AdminNav } from "@/components/AdminNav";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  const [org, rows] = await Promise.all([getOrg(user.orgId), listDocumentRows(user.orgId, user.email)]);
  return (
    <ToastProvider>
      <div className="shell">
        <Suspense>
          <AdminNav user={{ name: user.name, email: user.email, role: user.role }} brandName={org.brandName} counts={viewCounts(rows)} />
        </Suspense>
        <main className="main">{children}</main>
      </div>
    </ToastProvider>
  );
}
