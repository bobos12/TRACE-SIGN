import Link from "next/link";
import { FileStack, ShieldCheck, PenLine, Send } from "lucide-react";
import { requireUserPage } from "@/lib/auth";
import { listTemplates } from "@/lib/templates";
import { NewDocumentDrop } from "./NewDocumentDrop";

export const dynamic = "force-dynamic";
export const metadata = { title: "New document" };

export default async function NewDocumentPage() {
  const user = await requireUserPage();
  const templates = (await listTemplates(user.orgId)).slice(0, 4);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>New document</h1>
          <p>Upload a PDF, add the people who need to sign, and place their fields on the page.</p>
        </div>
      </div>
      <NewDocumentDrop />
      <div className="grid g3 section-gap">
        {[
          [PenLine, "Place fields precisely", "Signature, initials, name, date, text, email and checkbox fields, exactly where you need them."],
          [Send, "Sign in any order", "Everyone at once, or one after another. Recipients don't need an account."],
          [ShieldCheck, "Original pages only", "The signed PDF keeps its original page count, with a digital seal and a separate audit trail."],
        ].map(([Icon, t, d]) => {
          const I = Icon as typeof PenLine;
          return (
            <div key={t as string} className="card" style={{ display: "flex", gap: 12 }}>
              <div className="stat-ic"><I size={15} /></div>
              <div>
                <h3>{t as string}</h3>
                <p className="small muted" style={{ marginTop: 3 }}>{d as string}</p>
              </div>
            </div>
          );
        })}
      </div>
      {templates.length > 0 && (
        <div className="section-gap">
          <div className="row" style={{ marginBottom: 12 }}>
            <h2>Start from a template</h2>
            <span className="spacer" />
            <Link href="/admin/templates" className="small muted">All templates</Link>
          </div>
          <div className="grid g4">
            {templates.map((t) => (
              <Link key={t.id} href={`/admin/templates?use=${t.id}`} className="card stat" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="stat-ic"><FileStack size={15} /></div>
                <div style={{ minWidth: 0 }}>
                  <div className="small strong trunc">{t.name}</div>
                  <div className="xs muted">{(JSON.parse(t.roles) as unknown[]).length} roles · {t.pageCount} pages</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
