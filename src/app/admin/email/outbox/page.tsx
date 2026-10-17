import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, t } from "@/lib/db";
import { ActionButton, Pill, When } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery log" };

const STATUSES = ["queued", "sending", "sent", "retrying", "failed", "delivered", "bounced", "cancelled"];
const KIND_LABEL: Record<string, string> = {
  invite: "Signature request",
  reminder: "Reminder",
  opened: "Opened (admin)",
  declined: "Declined (admin)",
  cancelled: "Cancelled",
  completed: "Fully signed (admin)",
  expired: "Expired",
  completed_pdf: "Completed PDF",
  test: "Test",
};

export default async function OutboxPage({ searchParams }: { searchParams: { status?: string } }) {
  const status = STATUSES.includes(searchParams.status ?? "") ? searchParams.status! : null;
  const counts = await db.select({ status: t.emailMessages.status, n: sql<number>`count(*)::int` }).from(t.emailMessages).groupBy(t.emailMessages.status);
  const count = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const rows = await db
    .select({ e: t.emailMessages, title: t.documents.title })
    .from(t.emailMessages)
    .leftJoin(t.documents, eq(t.emailMessages.documentId, t.documents.id))
    .where(status ? eq(t.emailMessages.status, status) : undefined)
    .orderBy(desc(t.emailMessages.createdAt))
    .limit(200);
  const events = rows.length
    ? await db
        .select()
        .from(t.emailEvents)
        .where(inArray(t.emailEvents.emailId, rows.map((r) => r.e.id)))
        .orderBy(t.emailEvents.createdAt)
    : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Delivery log</h1>
          <p>Every email TRACE.SIGN has queued, with retries and delivery outcomes. Bounces are detected from the connected mailbox.</p>
        </div>
        <ActionButton url="/api/admin/email/process-queue" label="Process queue now" className="btn" />
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <Link href="/admin/email/outbox" className={`btn sm ${status ? "ghost" : ""}`}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/email/outbox?status=${s}`} className={`btn sm ${status === s ? "" : "ghost"}`}>
            {s} <span className="muted">{count(s)}</span>
          </Link>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Queued</th>
                <th>Type</th>
                <th>To</th>
                <th>Document</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Detail</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, title }) => (
                <tr key={e.id}>
                  <td className="small">
                    <When at={e.createdAt} />
                  </td>
                  <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                  <td className="trunc">
                    {e.toName ? <div>{e.toName}</div> : null}
                    <div className="small muted">{e.toEmail}</div>
                  </td>
                  <td className="trunc">{e.documentId ? <Link href={`/admin/documents/${e.documentId}`}>{title}</Link> : <span className="muted">—</span>}</td>
                  <td>
                    <Pill status={e.status} />
                  </td>
                  <td>{e.attempts}</td>
                  <td className="small" style={{ maxWidth: 360 }}>
                    {e.lastError ? <div style={{ color: e.status === "cancelled" ? "var(--muted)" : "var(--bad)" }}>{e.lastError.slice(0, 220)}</div> : e.sentAt ? <span className="muted">Sent <When at={e.sentAt} /></span> : null}
                    <details style={{ marginTop: 4 }}>
                      <summary className="muted" style={{ cursor: "pointer" }}>History</summary>
                      <ul className="timeline">
                        {events
                          .filter((ev) => ev.emailId === e.id)
                          .map((ev) => (
                            <li key={ev.id}>
                              <span className="muted">
                                <When at={ev.createdAt} />
                              </span>
                              <span>
                                <Pill status={ev.status} /> {ev.detail}
                              </span>
                            </li>
                          ))}
                      </ul>
                      {e.messageId && <div className="mono muted" style={{ fontSize: 11 }}>Message-ID {e.messageId}</div>}
                    </details>
                  </td>
                  <td>{["failed", "bounced", "cancelled"].includes(e.status) && e.kind !== "test" && <ActionButton url={`/api/admin/email/messages/${e.id}/resend`} label="Resend" confirm="Queue this email again?" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">No emails{status ? ` with status “${status}”` : " yet"}.</div>}
        </div>
      </div>
    </>
  );
}
