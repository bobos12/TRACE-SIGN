"use client";
import { useState } from "react";
import { FileUp } from "lucide-react";
import { api, Spinner } from "./ui";

const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_PDF_MB || 25);

/** Drag-and-drop PDF upload that POSTs to `url` and hands back the created id. */
export function PdfDrop({ url, onDone, title = "Drop your PDF here", hint = `or click to browse · PDF up to ${MAX_MB} MB` }: { url: string; onDone: (id: string) => void; title?: string; hint?: string }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return setErr("Only PDF files can be uploaded.");
    if (file.size > MAX_MB * 1024 * 1024) return setErr(`This PDF is larger than ${MAX_MB} MB.`);
    setErr(null);
    setBusy(file.name);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api<{ id: string }>(url, { method: "POST", body: fd });
      onDone(r.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <label
        className={`drop ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="drop-ic">{busy ? <Spinner size={22} /> : <FileUp size={24} />}</div>
        <h2>{busy ? `Uploading ${busy}…` : title}</h2>
        <p className="muted">{busy ? "Checking the file and reading its pages." : hint}</p>
        {!busy && <span className="btn dark" style={{ marginTop: 6 }}>Choose file</span>}
        <input type="file" accept="application/pdf,.pdf" disabled={!!busy} onChange={(e) => void upload(e.target.files?.[0])} aria-label="Upload PDF" />
      </label>
      {err && <div className="note bad">{err}</div>}
    </div>
  );
}
