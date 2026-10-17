"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Avatar, Empty, When } from "@/components/ui";
import { RECIPIENT_COLORS } from "@/lib/geometry";

interface C {
  email: string;
  name: string;
  documents: number;
  signed: number;
  pending: number;
  lastAt: string;
}

const colorFor = (s: string) => RECIPIENT_COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % RECIPIENT_COLORS.length];

export function ContactsTable({ rows, empty }: { rows: C[]; empty: React.ReactNode }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || r.email.includes(q.toLowerCase())), [rows, q]);
  return (
    <div className="card flush">
      <div className="toolbar">
        <div className="input-icon">
          <Search size={15} />
          <input type="search" placeholder="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" />
        </div>
        <span className="spacer" />
        <span className="xs muted">{list.length} contacts</span>
      </div>
      {list.length === 0 ? (
        <Empty icon={empty} title={rows.length ? "No matches" : "No contacts yet"}>
          {rows.length ? "Try another search." : "People you send documents to appear here automatically."}
        </Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Documents</th>
                <th>Signed</th>
                <th>Waiting</th>
                <th>Last sent</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.email}>
                  <td>
                    <div className="row nowrap" style={{ gap: 10 }}>
                      <Avatar name={c.name || c.email} email={c.email} color={colorFor(c.email)} />
                      <div>
                        <div className="small strong">{c.name || "—"}</div>
                        <div className="xs muted">{c.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{c.documents}</td>
                  <td>{c.signed}</td>
                  <td>{c.pending ? <span style={{ color: "var(--accent)", fontWeight: 600 }}>{c.pending}</span> : 0}</td>
                  <td className="small dim">
                    <When at={c.lastAt} mode="date" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
