import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { type LucideIcon, ArrowLeft, Ban, Bell, CheckCircle2, Download, Eye, FileCheck2, FileText, Mail, PenLine, Send, ShieldCheck, Signature, UserCheck, XCircle, AlarmClock, Hash, History, CircleAlert } from "lucide-react";
import { requireUserPage, canManage } from "@/lib/auth";
import { db, t } from "@/lib/db";
import { fieldsOf, getDocument, pagesOf, recipientsOf } from "@/lib/documents";
import { listEvents, verifyAuditChain } from "@/lib/audit";
import { ActionButton, Avatar, DocStatus, Pill, Progress, RecipientStatus, When } from "@/components/ui";
import { DocActions } from "./DocActions";
import { SignedViewer } from "@/app/sign/[token]/SignedViewer";

export const dynamic = "force-dynamic";

const EV: Record<string, [LucideIcon, string, string]> = {
  created: [FileText, "", "Document created"],
  sent: [Send, "accent", "Sent for signature"],
  invited: [Mail, "", "Invitation sent"],
  viewed: [Eye, "", "Viewed"],
  consent: [UserCheck, "", "Agreed to sign electronically"],
  signed: [Signature, "ok", "Signed"],
  completed: [CheckCircle2, "ok", "Completed"],
  pdf_ready: [FileCheck2, "ok", "Signed PDF sealed"],
  pdf_failed: [CircleAlert, "bad", "Signed PDF failed"],
  seal_failed: [CircleAlert, "bad", "Digital seal failed"],
  declined: [XCircle, "bad", "Declined"],
  voided: [Ban, "bad", "Cancelled"],
  expired: [AlarmClock, "bad", "Expired"],
  reminder: [Bell, "", "Reminder"],
  email_bounced: [CircleAlert, "bad", "Email bounced"],
};

export default async function DocumentDetail({ params, searchParams }: { params: { id: string }; searchParams: { sent?: string } }) {
  const user = await requireUserPage();
  let d;
  try {
    d = await getDocument(params.id, user.orgId);
  } catch {
    notFound();
  }
  if (d.status === "draft") {
    const { redirect } = await import("next/navigation");
    redirect(`/admin/documents/${d.id}/edit`);
  }
  const [recs, fields, events, chain, emails] = await Promise.all([
    recipientsOf(d.id),
    fieldsOf(d.id),
    listEvents(d.id),
    verifyAuditChain(d.id),
    db.select().from(t.emailMessages).where(eq(t.emailMessages.documentId, d.id)).orderBy(desc(t.emailMessages.createdAt)),
  ]);
  const open = d.status === "sent";
  const signed = recs.filter((r) => r.status === "signed").length;
  const me = recs.find((r) => r.email === user.email && (r.status === "sent" || r.status === "opened"));
  const recipientName = new Map(recs.map((r) => [r.id, r.name]));

  return (
    <>
      <Link href="/admin/documents" className="crumb">
        <ArrowLeft size={13} /> Documents
      </Link>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ wordBreak: "break-word" }}>{d.title}</h1>
          <div className="row" style={{ gap: 10, marginTop: 8 }}>
            <DocStatus status={d.status} waitingOnMe={!!me && open} />
            <span className="small muted">
              {d.signingOrder === "sequential" ? "Signing in order" : "Signing in any order"} · {d.pageCount} pages · {fields.length} fields
            </span>
          </div>
        </div>
        <div className="row">
          {me && open && (
            <a href={`/api/admin/documents/${d.id}/sign-now`} className="btn primary">
              <Signature size={15} /> Sign now
            </a>
          )}
          {d.completedSha256 && (
            <a className="btn primary" href={`/api/admin/documents/${d.id}/file?which=completed&download=1`}>
              <Download size={15} /> Signed PDF
            </a>
          )}
          {d.status === "completed" && !d.completedSha256 && <ActionButton url={`/api/admin/documents/${d.id}/finish`} label="Generate signed PDF" className="btn primary" />}
          <DocActions id={d.id} status={d.status} hasAudit={!!d.auditSha256} canDelete={canManage(user)} title={d.title} />
        </div>
      </div>

      {searchParams.sent && open && (
        <div className="note ok" style={{ marginBottom: 16 }}>
          <strong>Sent</strong>
          {d.signingOrder === "sequential" ? `${recs.find((r) => r.status !== "pending" && r.status !== "signed")?.name ?? "The first signer"} has been invited. Others are emailed in order.` : "Everyone has been emailed a secure signing link."}
        </div>
      )}

      <div className="grid detail-grid">
        <div className="stack" style={{ minWidth: 0 }}>
          <div className="card flush">
            <div className="card-sec row">
              <h2>Recipients</h2>
              <span className="spacer" />
              <span className="small muted">
                {signed} of {recs.length} signed
              </span>
              <div style={{ width: 90 }}>
                <Progress value={signed} total={recs.length} />
              </div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <tbody>
                  {recs.map((r) => (
                    <tr key={r.id}>
                      {d.signingOrder === "sequential" && (
                        <td style={{ width: 30 }}>
                          <span className="tag">{r.routingOrder}</span>
                        </td>
                      )}
                      <td>
                        <div className="row nowrap" style={{ gap: 10 }}>
                          <Avatar name={r.name} email={r.email} color={r.color} />
                          <div style={{ minWidth: 0 }}>
                            <div className="small strong">
                              {r.name} {r.roleLabel && <span className="muted" style={{ fontWeight: 400 }}>· {r.roleLabel}</span>}
                            </div>
                            <div className="xs muted">{r.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <RecipientStatus status={r.status} />
                      </td>
                      <td className="xs dim">
                        {r.signedAt ? (
                          <>
                            Signed <When at={r.signedAt} />
                            {r.signatureMethod && <div className="muted">{r.signatureMethod} signature</div>}
                          </>
                        ) : r.declinedAt ? (
                          <>
                            Declined <When at={r.declinedAt} />
                            {r.declineReason && <div className="muted">“{r.declineReason}”</div>}
                          </>
                        ) : r.openedAt ? (
                          <>
                            Viewed <When at={r.openedAt} mode="relative" />
                          </>
                        ) : r.invitedAt ? (
                          <>
                            Sent <When at={r.invitedAt} mode="relative" />
                          </>
                        ) : (
                          <span className="muted">{d.signingOrder === "sequential" && open ? `After step ${r.routingOrder - 1}` : "—"}</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {open && (r.status === "sent" || r.status === "opened") && <ActionButton url={`/api/admin/documents/${d.id}/remind`} body={{ recipientId: r.id }} label="Resend" icon={<Bell size={13} />} className="btn sm" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="card-sec row">
              <h2>{d.completedSha256 ? "Signed document" : "Document"}</h2>
              <span className="spacer" />
              <a className="small muted" href={`/api/admin/documents/${d.id}/file?which=${d.completedSha256 ? "completed" : "current"}`} target="_blank" rel="noreferrer">
                Open in new tab
              </a>
            </div>
            <SignedViewer src={`/api/admin/documents/${d.id}/file?which=current`} pages={pagesOf(d)} flush />
          </div>
        </div>

        <div className="stack" style={{ minWidth: 0 }}>
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>Details</h2>
            <dl className="kv" style={{ gridTemplateColumns: "100px 1fr" }}>
              <dt>From</dt>
              <dd>{d.senderName}</dd>
              <dt>Created</dt>
              <dd>
                <When at={d.createdAt} />
              </dd>
              <dt>Sent</dt>
              <dd>
                <When at={d.sentAt} />
              </dd>
              <dt>Expires</dt>
              <dd>
                <When at={d.expiresAt} empty="Never" />
              </dd>
              {d.completedAt && (
                <>
                  <dt>Completed</dt>
                  <dd>
                    <When at={d.completedAt} />
                  </dd>
                </>
              )}
              <dt>Reminders</dt>
              <dd>{d.reminderEveryDays ? `Every ${d.reminderEveryDays} days, up to ${d.maxReminders}` : "Off"}</dd>
              <dt>Document ID</dt>
              <dd className="mono" style={{ fontSize: 11 }}>{d.id}</dd>
            </dl>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={16} /> Integrity
            </h2>
            <div className="stack tight">
              <div className="row nowrap" style={{ alignItems: "flex-start" }}>
                <Hash size={14} style={{ marginTop: 2, color: "var(--text-3)" }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="xs muted">Original SHA-256</div>
                  <div className="mono" style={{ fontSize: 10.5, overflowWrap: "anywhere" }}>{d.fileSha256}</div>
                </div>
              </div>
              {d.completedSha256 && (
                <div className="row nowrap" style={{ alignItems: "flex-start" }}>
                  <Hash size={14} style={{ marginTop: 2, color: "var(--text-3)" }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="xs muted">Signed PDF SHA-256</div>
                    <div className="mono" style={{ fontSize: 10.5, overflowWrap: "anywhere" }}>{d.completedSha256}</div>
                  </div>
                </div>
              )}
              <div className="row" style={{ gap: 6, marginTop: 4 }}>
                <Pill status={chain.ok ? "ok" : "failed"} label={chain.ok ? `Audit log verified · ${chain.sealedEvents} events` : "Audit log check FAILED"} />
                {d.completedSha256 && <Pill status={d.sealed ? "ok" : "neutral"} label={d.sealed ? "Digitally sealed (PKCS#7)" : "Not sealed"} />}
              </div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <History size={16} /> Activity
            </h2>
            <ul className="timeline">
              {[...events].reverse().map((e) => {
                const [Icon, tone, label] = EV[e.type] ?? [FileText, "", e.type.replace(/_/g, " ")];
                const who = e.recipientId ? recipientName.get(e.recipientId) : e.actor?.startsWith("sender:") ? e.actor.slice(7) : null;
                return (
                  <li key={e.id}>
                    <span className={`tl-ic ${tone}`}>
                      <Icon size={12} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="small">
                        <b style={{ fontWeight: 560 }}>{label}</b>
                        {who && <span className="dim"> · {who}</span>}
                      </div>
                      {e.detail && !["signed", "viewed"].includes(e.type) && <div className="xs muted" style={{ wordBreak: "break-word" }}>{e.detail}</div>}
                      {e.ip && <div className="xs muted">IP {e.ip}</div>}
                    </div>
                    <When at={e.createdAt} mode="relative" />
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card">
            <div className="card-head" style={{ marginBottom: 10 }}>
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Mail size={16} /> Emails
              </h2>
              <Link href="/admin/email/outbox" className="small muted">
                Delivery log
              </Link>
            </div>
            {emails.length ? (
              <div className="stack tight">
                {emails.slice(0, 12).map((e) => (
                  <div key={e.id} className="row nowrap" style={{ gap: 10, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="small trunc" style={{ maxWidth: "100%" }}>{e.subject}</div>
                      <div className="xs muted">{e.toEmail}</div>
                      {e.lastError && e.status !== "sent" && <div className="xs" style={{ color: "var(--bad)" }}>{e.lastError.slice(0, 120)}</div>}
                    </div>
                    <Pill status={e.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">No emails yet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
