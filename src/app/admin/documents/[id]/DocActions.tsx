"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, Bell, Download, FileStack, MoreHorizontal, ShieldCheck, Trash2, FileText } from "lucide-react";
import { api, Menu, Modal, Spinner, useToast } from "@/components/ui";

export function DocActions({ id, status, hasAudit, canDelete, title }: { id: string; status: string; hasAudit: boolean; canDelete: boolean; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const [voidOpen, setVoidOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      after?.();
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {status === "sent" && (
        <button className="btn" disabled={busy} onClick={() => run(() => api(`/api/admin/documents/${id}/remind`, { json: {} }), "Reminder sent to everyone waiting")}>
          <Bell size={15} /> Remind
        </button>
      )}
      <Menu
        trigger={({ toggle }) => (
          <button className="btn icon" onClick={toggle} aria-label="More actions">
            <MoreHorizontal size={16} />
          </button>
        )}
      >
        {hasAudit && (
          <a href={`/api/admin/documents/${id}/file?which=audit&download=1`}>
            <ShieldCheck size={15} /> Download audit trail
          </a>
        )}
        <a href={`/api/admin/documents/${id}/file?which=original&download=1`}>
          <FileText size={15} /> Download original
        </a>
        {status === "completed" && (
          <a href={`/api/admin/documents/${id}/file?which=completed&download=1`}>
            <Download size={15} /> Download signed PDF
          </a>
        )}
        <button onClick={() => setTplOpen(true)}>
          <FileStack size={15} /> Save as template
        </button>
        {(status === "sent" || canDelete) && <hr />}
        {status === "sent" && (
          <button className="danger" onClick={() => setVoidOpen(true)}>
            <Ban size={15} /> Cancel request
          </button>
        )}
        {status !== "sent" && canDelete && (
          <button className="danger" onClick={() => window.confirm("Delete this document and its audit trail permanently?") && run(() => api(`/api/admin/documents/${id}`, { method: "DELETE" }), "Deleted", () => router.push("/admin/documents"))}>
            <Trash2 size={15} /> Delete permanently
          </button>
        )}
      </Menu>
      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title="Cancel this signature request?"
        subtitle="All signing links stop working and recipients who were invited are told. This can't be undone."
        footer={
          <>
            <button className="btn" onClick={() => setVoidOpen(false)}>
              Keep it
            </button>
            <button className="btn danger solid" disabled={busy} onClick={() => run(() => api(`/api/admin/documents/${id}/void`, { json: { reason } }), "Request cancelled", () => setVoidOpen(false))}>
              {busy && <Spinner />} Cancel request
            </button>
          </>
        }
      >
        <label className="f">
          Reason <span className="hint">Optional, for the audit trail.</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      </Modal>
      <Modal
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        title="Save as template"
        subtitle="Keeps the PDF, roles and every field placement."
        footer={
          <>
            <button className="btn" onClick={() => setTplOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !name.trim()} onClick={() => run(() => api(`/api/admin/documents/${id}/save-template`, { json: { name } }), "Template saved", () => setTplOpen(false))}>
              Save template
            </button>
          </>
        }
      >
        <label className="f">
          Template name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </label>
      </Modal>
    </>
  );
}
