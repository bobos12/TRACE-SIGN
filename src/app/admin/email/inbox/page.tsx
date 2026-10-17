import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { ActionButton, Pill, When } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Incoming mail" };

export default async function InboxPage() {
  const s = await getSettings();
  const rows = await db
    .select({ m: t.inboundEmails, title: t.documents.title })
    .from(t.inboundEmails)
    .leftJoin(t.documents, eq(t.inboundEmails.documentId, t.documents.id))
    .orderBy(desc(t.inboundEmails.importedAt))
    .limit(200);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Incoming mail</h1>
          <p>
            Replies, auto-replies and bounces for TRACE.SIGN emails, imported read-only from <span className="mono">{s.imapMailbox}</span>
            {s.imapHost ? ` on ${s.imapHost}` : ""}. Originals stay untouched in your mailbox.
          </p>
        </div>
        {s.imapEnabled && <ActionButton url="/api/admin/email/sync-imap" label="Sync now" className="btn" />}
      </div>
      {!s.imapEnabled && (
        <div className="note warn" style={{ marginBottom: 16 }}>
          <strong>IMAP is off</strong>
          Turn it on in <Link href="/admin/email">Email Integration</Link> to see replies and bounces here.
        </div>
      )}
      {s.imapLastError && <div className="note bad" style={{ marginBottom: 16 }}>{s.imapLastError}</div>}
      <div className="card" style={{ padding: 0 }}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Received</th>
                <th>Type</th>
                <th>From</th>
                <th>Subject</th>
                <th>Document</th>
                <th>Linked by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, title }) => (
                <tr key={m.id}>
                  <td className="small">
                    <When at={m.sentAt ?? m.importedAt} />
                  </td>
                  <td>
                    <Pill status={m.kind} label={m.kind === "auto_reply" ? "auto-reply" : m.kind} />
                  </td>
                  <td className="trunc">
                    {m.fromName && <div>{m.fromName}</div>}
                    <div className="small muted">{m.fromEmail}</div>
                  </td>
                  <td className="trunc">
                    <Link href={`/admin/email/inbox/${m.id}`}>{m.subject || "(no subject)"}</Link>
                  </td>
                  <td className="trunc">{m.documentId ? <Link href={`/admin/documents/${m.documentId}`}>{title}</Link> : <span className="muted">Not linked</span>}</td>
                  <td className="small muted">{m.matchedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">Nothing imported yet.</div>}
        </div>
      </div>
    </>
  );
}
