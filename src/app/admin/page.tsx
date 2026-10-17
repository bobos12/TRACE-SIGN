import Link from "next/link";
import { CheckCircle2, Clock, FileStack, Inbox, PenLine, Plus } from "lucide-react";
import { requireUserPage } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getOrg } from "@/lib/org";
import { inView, listDocumentRows, serializeRows, viewCounts } from "@/lib/queries";
import { DocumentsTable } from "@/components/DocumentsTable";
import { PdfDropClient } from "./PdfDropClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

export default async function Overview() {
  const user = await requireUserPage();
  const [rows, s, org] = await Promise.all([listDocumentRows(user.orgId, user.email), getSettings(), getOrg(user.orgId)]);
  const c = viewCounts(rows);
  const since = Date.now() - 30 * 86400_000;
  const completed30 = rows.filter((r) => r.status === "completed" && r.completedAt && new Date(r.completedAt).getTime() > since).length;
  const mine = rows.filter((r) => inView(r, "waiting_me"));
  const configured = !!(s.smtpHost && s.smtpUser && s.smtpPassEnc);
  const hour = new Date().getHours();
  const first = user.name && user.name !== "Owner" ? user.name.split(" ")[0] : null;

  const stats = [
    { href: "/admin/documents?view=waiting_me", icon: Inbox, label: "Waiting for me", n: c.waiting_me, sub: "Your turn to sign", hot: c.waiting_me > 0 },
    { href: "/admin/documents?view=waiting_others", icon: Clock, label: "Waiting for others", n: c.waiting_others, sub: "Out for signature" },
    { href: "/admin/documents?view=completed", icon: CheckCircle2, label: "Completed", n: completed30, sub: "Last 30 days" },
    { href: "/admin/documents?view=drafts", icon: PenLine, label: "Drafts", n: c.drafts, sub: "Not sent yet" },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}{first ? `, ${first}` : ""}</h1>
          <p>Here&apos;s what&apos;s happening in {org.name}.</p>
        </div>
        <div className="row">
          <Link href="/admin/templates" className="btn">
            <FileStack size={15} /> Use a template
          </Link>
          <Link href="/admin/documents/new" className="btn primary">
            <Plus size={15} /> New document
          </Link>
        </div>
      </div>

      {!configured && (
        <div className="note warn" style={{ marginBottom: 16 }}>
          <strong>Connect your mailbox to send invitations</strong>
          You can prepare documents now. Invitations wait in the queue until you connect email in <Link href="/admin/email">Email delivery</Link>.
        </div>
      )}
      {s.lastSmtpError && (
        <div className="note bad" style={{ marginBottom: 16 }}>
          <strong>Email sending problem</strong>
          {s.lastSmtpError} <Link href="/admin/email">Open email settings</Link>
        </div>
      )}

      <div className="grid g4">
        {stats.map((x) => (
          <Link key={x.label} href={x.href} className="card stat">
            <div className="stat-top">
              <span className="stat-ic" style={x.hot ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}>
                <x.icon size={14} />
              </span>
              <span className="stat-l">{x.label}</span>
            </div>
            <div className="stat-n" style={x.hot ? { color: "var(--accent)" } : undefined}>{x.n}</div>
            <div className="stat-s">{x.sub}</div>
          </Link>
        ))}
      </div>

      {mine.length > 0 && (
        <div className="section-gap">
          <h2 style={{ marginBottom: 12 }}>Needs your signature</h2>
          <DocumentsTable rows={serializeRows(mine)} compact />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="section-gap">
          <PdfDropClient />
        </div>
      ) : (
        <div className="section-gap">
          <div className="row" style={{ marginBottom: 12 }}>
            <h2>Recent activity</h2>
            <span className="spacer" />
            <Link href="/admin/documents" className="small muted">
              View all
            </Link>
          </div>
          <DocumentsTable rows={serializeRows(rows.slice(0, 8))} compact />
        </div>
      )}
    </>
  );
}
