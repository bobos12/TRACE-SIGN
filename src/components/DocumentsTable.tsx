"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowDownUp, Ban, Bell, Download, Eye, FileText, MoreHorizontal, PenLine, Search, Signature, Trash2 } from "lucide-react";
import { api, Avatar, DocStatus, Empty, Menu, Progress, When, useToast } from "./ui";

export interface Row {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  lastActivityAt: string;
  hasSigned: boolean;
  recipients: { id: string; name: string; email: string; status: string; color: string; order: number }[];
  signed: number;
  total: number;
  waitingOnMe: boolean;
}

type SortKey = "activity" | "created" | "sent" | "name" | "status";
const STATUS_FILTERS = ["any", "draft", "sent", "completed", "declined", "expired", "voided"] as const;
const STATUS_LABEL: Record<string, string> = { any: "Any status", draft: "Draft", sent: "Out for signature", completed: "Completed", declined: "Declined", expired: "Expired", voided: "Cancelled" };

export function DocumentsTable({ rows, compact, emptyHint }: { rows: Row[]; compact?: boolean; emptyHint?: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("any");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "activity", dir: -1 });

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) => (status === "any" || r.status === status) && (!needle || r.title.toLowerCase().includes(needle) || r.recipients.some((x) => x.name.toLowerCase().includes(needle) || x.email.includes(needle))));
    const key = (r: Row): string | number => {
      switch (sort.key) {
        case "name":
          return r.title.toLowerCase();
        case "status":
          return r.status;
        case "created":
          return r.createdAt;
        case "sent":
          return r.sentAt ?? "";
        default:
          return r.lastActivityAt;
      }
    };
    return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * sort.dir);
  }, [rows, q, status, sort]);

  const th = (k: SortKey, label: string) => (
    <th aria-sort={sort.key === k ? (sort.dir > 0 ? "ascending" : "descending") : undefined}>
      <button onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === "name" ? 1 : -1 }))}>
        {label} {sort.key === k && <ArrowDownUp size={11} />}
      </button>
    </th>
  );

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  return (
    <div className="card flush">
      {!compact && (
        <div className="toolbar">
          <div className="input-icon">
            <Search size={15} />
            <input type="search" placeholder="Search documents or recipients" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ width: "auto" }} aria-label="Filter by status">
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <span className="xs muted">
            {list.length} of {rows.length}
          </span>
        </div>
      )}
      {list.length === 0 ? (
        <Empty icon={<FileText size={20} />} title={rows.length ? "No matching documents" : "Nothing here yet"}>
          {rows.length ? "Try a different search or filter." : emptyHint}
        </Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {th("name", "Document")}
                <th>Recipients</th>
                {th("status", "Status")}
                <th>Progress</th>
                {!compact && th("created", "Created")}
                {!compact && th("sent", "Sent")}
                {th("activity", "Last activity")}
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const href = r.status === "draft" ? `/admin/documents/${r.id}/edit` : `/admin/documents/${r.id}`;
                return (
                  <tr key={r.id} className="clickable" onClick={(e) => !(e.target as HTMLElement).closest("button, a, .menu") && router.push(href)}>
                    <td style={{ maxWidth: 320 }}>
                      <Link href={href} className="trunc" style={{ display: "block", color: "var(--text)" }}>
                        {r.title}
                      </Link>
                      {r.expiresAt && r.status === "sent" && (
                        <div className="xs muted">
                          Expires <When at={r.expiresAt} mode="relative" />
                        </div>
                      )}
                    </td>
                    <td>
                      {r.recipients.length ? (
                        <div className="row nowrap" style={{ gap: 8 }}>
                          <span className="avatars">
                            {r.recipients.slice(0, 4).map((x) => (
                              <Avatar key={x.id} name={x.name || x.email} email={x.email} color={x.color} />
                            ))}
                          </span>
                          <span className="small dim trunc" style={{ maxWidth: 160 }}>
                            {r.recipients.map((x) => x.name || x.email).join(", ")}
                          </span>
                        </div>
                      ) : (
                        <span className="muted small">None yet</span>
                      )}
                    </td>
                    <td>
                      <DocStatus status={r.status} waitingOnMe={r.waitingOnMe} />
                    </td>
                    <td style={{ minWidth: 110 }}>
                      {r.total > 0 && r.status !== "draft" ? (
                        <div className="row nowrap" style={{ gap: 8 }}>
                          <Progress value={r.signed} total={r.total} />
                          <span className="xs muted nowrap">
                            {r.signed}/{r.total}
                          </span>
                        </div>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    {!compact && (
                      <td className="small dim">
                        <When at={r.createdAt} mode="date" />
                      </td>
                    )}
                    {!compact && (
                      <td className="small dim">
                        <When at={r.sentAt} mode="date" />
                      </td>
                    )}
                    <td className="small dim">
                      <When at={r.lastActivityAt} mode="relative" />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Menu
                        trigger={({ toggle }) => (
                          <button className="btn ghost icon sm" onClick={toggle} aria-label={`Actions for ${r.title}`}>
                            <MoreHorizontal size={15} />
                          </button>
                        )}
                      >
                        {r.waitingOnMe && (
                          <a href={`/api/admin/documents/${r.id}/sign-now`}>
                            <Signature size={15} /> Sign now
                          </a>
                        )}
                        {r.status === "draft" ? (
                          <Link href={`/admin/documents/${r.id}/edit`}>
                            <PenLine size={15} /> Continue editing
                          </Link>
                        ) : (
                          <Link href={`/admin/documents/${r.id}`}>
                            <Eye size={15} /> View details
                          </Link>
                        )}
                        {r.status === "sent" && (
                          <button onClick={() => act(() => api(`/api/admin/documents/${r.id}/remind`, { json: {} }), "Reminder sent")}>
                            <Bell size={15} /> Resend to waiting signers
                          </button>
                        )}
                        {r.hasSigned && (
                          <a href={`/api/admin/documents/${r.id}/file?which=completed&download=1`}>
                            <Download size={15} /> Download signed PDF
                          </a>
                        )}
                        {r.status === "sent" && (
                          <>
                            <hr />
                            <button className="danger" onClick={() => window.confirm("Cancel this signature request? Signing links stop working and recipients are told.") && act(() => api(`/api/admin/documents/${r.id}/void`, { json: {} }), "Request cancelled")}>
                              <Ban size={15} /> Cancel request
                            </button>
                          </>
                        )}
                        {r.status !== "sent" && (
                          <>
                            <hr />
                            <button className="danger" onClick={() => window.confirm(`Delete “${r.title}”? This can't be undone.`) && act(() => api(`/api/admin/documents/${r.id}`, { method: "DELETE" }), "Document deleted")}>
                              <Trash2 size={15} /> Delete
                            </button>
                          </>
                        )}
                      </Menu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
