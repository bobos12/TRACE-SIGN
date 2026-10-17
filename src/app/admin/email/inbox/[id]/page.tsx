import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { Pill, When } from "@/components/ui";

export const dynamic = "force-dynamic";

const MATCH: Record<string, string> = {
  "in-reply-to": "Reply header points at a TRACE.SIGN email (reliable)",
  references: "Thread references a TRACE.SIGN email (reliable)",
  bounce: "Bounce report quotes a TRACE.SIGN Message-ID (reliable)",
  sender: "Sender is a recipient of exactly one document (likely)",
};

export default async function InboundDetail({ params }: { params: { id: string } }) {
  const [m] = await db.select().from(t.inboundEmails).where(eq(t.inboundEmails.id, params.id));
  if (!m) notFound();
  const [doc] = m.documentId ? await db.select({ id: t.documents.id, title: t.documents.title }).from(t.documents).where(eq(t.documents.id, m.documentId)) : [];
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/email/inbox" className="small muted">
            ← Incoming mail
          </Link>
          <h1 style={{ marginTop: 6 }}>{m.subject || "(no subject)"}</h1>
        </div>
        <a className="btn ghost" href={`/api/admin/inbound/${m.id}/raw`}>
          Download original (.eml)
        </a>
      </div>
      <div className="grid g2">
        <div className="card">
          <table className="tbl">
            <tbody>
              <tr><td className="muted">Type</td><td><Pill status={m.kind} /></td></tr>
              <tr><td className="muted">From</td><td>{m.fromName ? `${m.fromName} ` : ""}&lt;{m.fromEmail}&gt;</td></tr>
              <tr><td className="muted">To</td><td>{m.toList}</td></tr>
              <tr><td className="muted">Date</td><td><When at={m.sentAt} /></td></tr>
              <tr><td className="muted">Message-ID</td><td className="mono small" style={{ wordBreak: "break-all" }}>{m.messageId}</td></tr>
              <tr><td className="muted">Mailbox</td><td className="small">{m.mailbox} · UID {m.uid} (UIDVALIDITY {m.uidValidity})</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Document</h3>
          {doc ? (
            <p>
              <Link href={`/admin/documents/${doc.id}`}>{doc.title}</Link>
              <br />
              <span className="small muted">{MATCH[m.matchedBy ?? ""] ?? m.matchedBy}</span>
            </p>
          ) : (
            <p className="muted small">Not linked. TRACE.SIGN only links a message when it can identify the document reliably.</p>
          )}
        </div>
      </div>
      <div className="card section-gap">
        <h3 style={{ marginBottom: 12 }}>Message (plain text)</h3>
        <pre className="mailbody">{m.textBody || "(no plain-text body — download the original to view)"}</pre>
      </div>
    </>
  );
}
