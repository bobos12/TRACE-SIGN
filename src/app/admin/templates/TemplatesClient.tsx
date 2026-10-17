"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FileStack, MoreHorizontal, PenLine, Plus, Send, Trash2 } from "lucide-react";
import { api, Empty, Menu, Modal, Spinner, When, useToast } from "@/components/ui";
import { PdfDrop } from "@/components/Upload";
import { EMAIL_RE } from "@/lib/geometry";

interface Tpl {
  id: string;
  name: string;
  description: string | null;
  pageCount: number;
  signingOrder: string;
  roles: { key: string; label: string; color: string; order: number; name?: string | null; email?: string | null }[];
  fieldCount: number;
  useCount: number;
  updatedAt: string;
}

export function TemplatesClient({ templates, openUse }: { templates: Tpl[]; openUse: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [use, setUse] = useState<Tpl | null>(null);
  useEffect(() => {
    if (openUse) setUse(templates.find((t) => t.id === openUse) ?? null);
  }, [openUse, templates]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <p>Reusable documents with roles and fields already placed. Just add names and emails, then send.</p>
        </div>
        <button className="btn primary" onClick={() => setUploadOpen(true)}>
          <Plus size={15} /> New template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="card">
          <Empty icon={<FileStack size={20} />} title="No templates yet" action={<button className="btn" onClick={() => setUploadOpen(true)}><Plus size={14} /> Create a template</button>}>
            Upload a PDF to make a template, or open any prepared document and choose <b>Save as template</b>.
          </Empty>
        </div>
      ) : (
        <div className="grid g3">
          {templates.map((t) => (
            <div key={t.id} className="card tpl-card">
              <div className="tpl-thumb">
                <div className="sheet">
                  <i style={{ width: "70%" }} />
                  <i />
                  <i />
                  <i style={{ width: "80%" }} />
                  <div style={{ display: "flex", gap: 4, marginTop: "auto" }}>
                    {t.roles.slice(0, 3).map((r) => (
                      <b key={r.key} style={{ flex: 1, background: `${r.color}33`, border: `1px solid ${r.color}` }} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="row nowrap" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 className="trunc" style={{ maxWidth: "100%" }}>{t.name}</h3>
                  <div className="xs muted" style={{ marginTop: 3 }}>
                    {t.pageCount} pages · {t.fieldCount} fields · used {t.useCount}× · edited <When at={t.updatedAt} mode="relative" />
                  </div>
                </div>
                <Menu
                  trigger={({ toggle }) => (
                    <button className="btn ghost icon sm" onClick={toggle} aria-label="Template actions">
                      <MoreHorizontal size={15} />
                    </button>
                  )}
                >
                  <Link href={`/admin/templates/${t.id}/edit`}>
                    <PenLine size={15} /> Edit fields
                  </Link>
                  <hr />
                  <button
                    className="danger"
                    onClick={async () => {
                      if (!window.confirm(`Delete template “${t.name}”? Documents already sent aren't affected.`)) return;
                      try {
                        await api(`/api/admin/templates/${t.id}`, { method: "DELETE" });
                        toast("Template deleted");
                        router.refresh();
                      } catch (e) {
                        toast((e as Error).message, "bad");
                      }
                    }}
                  >
                    <Trash2 size={15} /> Delete
                  </button>
                </Menu>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {t.roles.map((r) => (
                  <span key={r.key} className="tag">
                    <span className="dot" style={{ background: r.color, width: 6, height: 6 }} /> {r.label}
                  </span>
                ))}
              </div>
              <button className="btn primary block" onClick={() => setUse(t)}>
                <Send size={14} /> Use template
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="New template" subtitle="Upload the PDF, then place fields for each role.">
        <PdfDrop url="/api/admin/templates" onDone={(id) => router.push(`/admin/templates/${id}/edit`)} />
      </Modal>
      {use && <UseDialog tpl={use} onClose={() => (setUse(null), openUse && router.replace("/admin/templates"))} />}
    </>
  );
}

function UseDialog({ tpl, onClose }: { tpl: Tpl; onClose: () => void }) {
  const router = useRouter();
  const roles = [...tpl.roles].sort((a, b) => a.order - b.order);
  const [people, setPeople] = useState<Record<string, { name: string; email: string }>>(() => Object.fromEntries(roles.map((r) => [r.key, { name: r.name ?? "", email: r.email ?? "" }])));
  const [title, setTitle] = useState(tpl.name);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"send" | "edit" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valid = roles.every((r) => people[r.key]?.name.trim() && EMAIL_RE.test(people[r.key]?.email.trim() ?? ""));

  const go = async (send: boolean) => {
    setBusy(send ? "send" : "edit");
    setErr(null);
    try {
      const r = await api<{ id: string }>(`/api/admin/templates/${tpl.id}/use`, { json: { title, message: message || null, recipients: people, send } });
      router.push(send ? `/admin/documents/${r.id}?sent=1` : `/admin/documents/${r.id}/edit`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Use “${tpl.name}”`}
      subtitle={tpl.signingOrder === "sequential" ? "Recipients sign in the order shown." : "All recipients are invited at once."}
      footer={
        <>
          <button className="btn" disabled={!!busy || !valid} onClick={() => go(false)} style={{ marginRight: "auto" }}>
            {busy === "edit" ? <Spinner /> : <PenLine size={14} />} Review fields first
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!!busy || !valid} onClick={() => go(true)}>
            {busy === "send" ? <Spinner /> : <Send size={14} />} Send now
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="f">
          Document name
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        {roles.map((r, i) => (
          <div key={r.key}>
            <div className="small strong" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
              {tpl.signingOrder === "sequential" && <span className="tag">{i + 1}</span>}
              <span className="dot" style={{ background: r.color }} /> {r.label}
            </div>
            <div className="grid g2" style={{ gap: 8 }}>
              <input placeholder="Full name" value={people[r.key]?.name ?? ""} onChange={(e) => setPeople((p) => ({ ...p, [r.key]: { ...p[r.key], name: e.target.value } }))} aria-label={`${r.label} name`} />
              <input type="email" placeholder="Email" value={people[r.key]?.email ?? ""} onChange={(e) => setPeople((p) => ({ ...p, [r.key]: { ...p[r.key], email: e.target.value } }))} aria-label={`${r.label} email`} />
            </div>
          </div>
        ))}
        <label className="f">
          Message <span className="hint">Optional</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
        </label>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}
