import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUserPage } from "@/lib/auth";
import { inView, listDocumentRows, serializeRows, VIEW_LABEL, VIEWS, type View } from "@/lib/queries";
import { DocumentsTable } from "@/components/DocumentsTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

const SUB: Record<View, string> = {
  all: "Every document in your workspace.",
  drafts: "Prepared but not sent yet.",
  waiting_me: "Documents where it's your turn to sign.",
  waiting_others: "Sent and waiting on other signers.",
  completed: "Signed by everyone. Download the sealed PDF and audit trail.",
  declined: "Declined by a signer or cancelled by the sender.",
  expired: "The signing deadline passed before everyone signed.",
};

export default async function DocumentsPage({ searchParams }: { searchParams: { view?: string } }) {
  const user = await requireUserPage();
  const view = (VIEWS as readonly string[]).includes(searchParams.view ?? "") ? (searchParams.view as View) : "all";
  const rows = (await listDocumentRows(user.orgId, user.email)).filter((r) => inView(r, view));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{VIEW_LABEL[view]}</h1>
          <p>{SUB[view]}</p>
        </div>
        <Link href="/admin/documents/new" className="btn primary">
          <Plus size={15} /> New document
        </Link>
      </div>
      <DocumentsTable
        rows={serializeRows(rows)}
        emptyHint={
          view === "all" || view === "drafts" ? (
            <>
              <Link href="/admin/documents/new">Upload a PDF</Link> to prepare your first document.
            </>
          ) : undefined
        }
      />
    </>
  );
}
