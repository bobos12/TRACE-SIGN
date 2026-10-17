"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Check, ChevronRight, Download, FileCheck2, MoreHorizontal, ShieldCheck, XCircle, ZoomIn, ZoomOut } from "lucide-react";
import { formatDate, type FieldOptions, type FieldType, type PageInfo } from "@/lib/geometry";
import { api, Menu, Modal, Spinner } from "@/components/ui";
import { Mark } from "@/components/Logo";
import { PdfPage, useFitScale, usePdf } from "@/components/pdf/PdfPages";
import { FIELD_ICON, fieldFontPx } from "@/components/editor/fieldMeta";
import { AdoptDialog, type Adopted } from "./SignaturePad";

export interface SignField {
  id: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  label: string | null;
  placeholder: string | null;
  defaultValue: string | null;
  options: FieldOptions;
}

export interface SignProps {
  token: string;
  brand: { name: string; company: string; accent: string; orgId: string };
  doc: { title: string; senderName: string; message: string | null; pages: PageInfo[]; expiresAt: string | null };
  recipient: { name: string; email: string; color: string; consented: boolean };
  fields: SignField[];
  dateFormat: string;
  timeZone: string;
}

const PX = 96 / 72;

export function SignRoom(p: SignProps) {
  const { token, doc, recipient, fields } = p;
  const enc = encodeURIComponent(token);
  const scroller = useRef<HTMLDivElement>(null);
  const { doc: pdf, error: pdfErr } = usePdf(`/api/sign/${enc}/pdf`);
  const fit = useFitScale(scroller, doc.pages, { max: 1.35 * PX, padding: 28 });
  const [zoom, setZoom] = useState<number | null>(null);
  const scale = zoom ?? fit;

  const [consented, setConsented] = useState(recipient.consented);
  const [consentOpen, setConsentOpen] = useState(!recipient.consented);
  const [agree, setAgree] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) {
      if (f.type === "name") v[f.id] = f.defaultValue || recipient.name;
      else if (f.type === "email") v[f.id] = f.defaultValue || recipient.email;
      else if (f.type === "text" && f.defaultValue) v[f.id] = f.defaultValue;
      else if (f.type === "checkbox") v[f.id] = f.defaultValue === "true" ? "true" : "false";
    }
    return v;
  });
  const [sig, setSig] = useState<Adopted | null>(null);
  const [ini, setIni] = useState<Adopted | null>(null);
  const [adopt, setAdopt] = useState<{ kind: "signature" | "initials"; fieldId: string } | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [sheet, setSheet] = useState<SignField | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | "signed" | "declined">(null);

  // Decided after mount (not during SSR) so server and client render the same markup.
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    void fetch(`/api/sign/${enc}/open`, { method: "POST" }).catch(() => undefined);
  }, [enc]);

  // Reading order: page, then top-to-bottom, then left-to-right.
  const ordered = useMemo(() => [...fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x), [fields]);
  const isDone = useCallback(
    (f: SignField) => {
      const v = values[f.id];
      switch (f.type) {
        case "signature":
        case "initials":
          return v === "signed";
        case "date":
          return true;
        case "checkbox":
          return !f.required || v === "true";
        default:
          return !!v?.trim();
      }
    },
    [values],
  );
  const required = ordered.filter((f) => f.required && f.type !== "date");
  const remaining = required.filter((f) => !isDone(f));
  const progress = required.length ? (required.length - remaining.length) / required.length : 1;
  const today = formatDate(new Date(), p.dateFormat, p.timeZone);

  const goTo = (f: SignField | undefined) => {
    if (!f) return;
    setCurrent(f.id);
    setStarted(true);
    const el = document.querySelector<HTMLElement>(`[data-sf="${f.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => el.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }), 350);
    } else {
      // page not laid out yet: scroll its page into view, then retry
      document.querySelector(`[data-page="${f.page}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => document.querySelector<HTMLElement>(`[data-sf="${f.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 500);
    }
  };
  const next = () => {
    const after = remaining.find((f) => ordered.indexOf(f) > ordered.findIndex((x) => x.id === current)) ?? remaining[0];
    goTo(after);
  };

  const applySigned = (kind: "signature" | "initials", fieldId: string) => {
    setValues((v) => ({ ...v, [fieldId]: "signed" }));
    setCurrent(fieldId);
    // Move on automatically to the next thing to do.
    setTimeout(() => {
      const rest = ordered.filter((f) => f.required && f.type !== "date" && f.id !== fieldId && !isDone(f));
      if (rest.length) goTo(rest.find((f) => ordered.indexOf(f) > ordered.findIndex((x) => x.id === fieldId)) ?? rest[0]);
    }, 250);
    void kind;
  };

  const activate = (f: SignField) => {
    if (!consented) return setConsentOpen(true);
    setCurrent(f.id);
    setStarted(true);
    if (f.type === "signature" || f.type === "initials") {
      const have = f.type === "signature" ? sig : ini;
      if (values[f.id] === "signed") {
        if (!f.required) setValues((v) => ({ ...v, [f.id]: "" })); // optional: click again to remove
        return;
      }
      if (have) applySigned(f.type, f.id);
      else setAdopt({ kind: f.type, fieldId: f.id });
    } else if (f.type === "checkbox") {
      setValues((v) => ({ ...v, [f.id]: v[f.id] === "true" ? "false" : "true" }));
    } else if (f.type !== "date") {
      const hPx = f.h * doc.pages[f.page].h * scale;
      if (hPx < 26 || touch) setSheet(f);
    }
  };

  async function finish() {
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = { action: "complete", consent: true, values: Object.fromEntries(Object.entries(values).filter(([k]) => fields.some((f) => f.id === k && f.type !== "date"))) };
      if (sig && fields.some((f) => f.type === "signature" && values[f.id] === "signed")) payload.signature = sig;
      if (ini && fields.some((f) => f.type === "initials" && values[f.id] === "signed")) payload.initials = ini;
      if (!fields.some((f) => f.type === "signature" || f.type === "initials") && sig) payload.signature = sig;
      await api(`/api/sign/${enc}`, { json: payload });
      setDone("signed");
      setTimeout(() => window.location.reload(), 1400);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const legacyNoFields = fields.length === 0;
  const canFinish = consented && remaining.length === 0 && (!legacyNoFields || !!sig);

  if (done)
    return (
      <div className="status-hero" style={{ marginTop: "18vh" }}>
        <div className="ic">
          <Check size={26} />
        </div>
        <h1>{done === "signed" ? "Thanks, you're done" : "Declined"}</h1>
        <p>{done === "signed" ? "Your signature has been recorded. We'll email you a copy when everyone has signed." : "The sender has been notified."}</p>
      </div>
    );

  return (
    <div className="sg" style={{ ["--accent" as string]: p.brand.accent }}>
      <header className="sg-top">
        <div className="sg-top-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.brand.orgId !== "default" ? <img src={`/api/brand/logo?org=${encodeURIComponent(p.brand.orgId)}`} alt="" height={24} style={{ maxWidth: 90, objectFit: "contain" }} /> : <Mark size={24} />}
          <div className="sg-doc">
            <h1>{doc.title}</h1>
            <p>
              {doc.senderName} · for {recipient.name}
            </p>
          </div>
          <div className="row nowrap" style={{ gap: 4 }}>
            <button className="btn ghost icon sm" onClick={() => setZoom(Math.max(0.4 * PX, scale - 0.2 * PX))} aria-label="Zoom out">
              <ZoomOut size={15} />
            </button>
            <button className="btn ghost icon sm" onClick={() => setZoom(Math.min(2.5 * PX, scale + 0.2 * PX))} aria-label="Zoom in">
              <ZoomIn size={15} />
            </button>
            <Menu
              trigger={({ toggle }) => (
                <button className="btn icon sm" onClick={toggle} aria-label="More options">
                  <MoreHorizontal size={15} />
                </button>
              )}
            >
              <a href={`/api/sign/${enc}/pdf?download=1`}>
                <Download size={15} /> Download PDF
              </a>
              <hr />
              <button className="danger" onClick={() => setDeclineOpen(true)}>
                <XCircle size={15} /> Decline to sign
              </button>
            </Menu>
          </div>
        </div>
        <div className="sg-progress" aria-hidden="true">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </header>

      {doc.message && (
        <div className="sg-banner note">
          <strong>Message from {doc.senderName}</strong>
          <span style={{ whiteSpace: "pre-wrap" }}>{doc.message}</span>
        </div>
      )}
      {pdfErr && <div className="sg-banner note bad">{pdfErr}</div>}

      <div className="sg-pages" ref={scroller}>
        {doc.pages.map((info, i) => (
          <PdfPage key={i} doc={pdf} index={i} info={info} scale={scale}>
            {ordered
              .filter((f) => f.page === i)
              .map((f) => (
                <SigningField
                  key={f.id}
                  f={f}
                  hPx={f.h * info.h * scale}
                  scale={scale}
                  touch={touch}
                  color={recipient.color}
                  value={values[f.id]}
                  done={isDone(f)}
                  current={current === f.id}
                  showTag={started && current === f.id}
                  today={today}
                  sig={f.type === "signature" ? sig : f.type === "initials" ? ini : null}
                  onActivate={() => activate(f)}
                  onText={(v) => setValues((s) => ({ ...s, [f.id]: v }))}
                  onFocus={() => setCurrent(f.id)}
                />
              ))}
          </PdfPage>
        ))}
      </div>
      <div className="sg-foot">
        Secured by {p.brand.name} · POWERED BY <strong>TRACE.STUDIO</strong>
      </div>

      <div className="sg-dock">
        <div className="sg-dock-in">
          <div className="count" style={{ flex: 1 }}>
            {legacyNoFields ? (
              "Adopt your signature to sign this document."
            ) : remaining.length ? (
              <>
                <b>{remaining.length}</b> required field{remaining.length === 1 ? "" : "s"} left
              </>
            ) : (
              <>
                <Check size={14} style={{ verticalAlign: -2, color: "var(--ok)" }} /> All required fields complete
              </>
            )}
          </div>
          {legacyNoFields && !sig ? (
            <button className="btn primary lg" onClick={() => (consented ? setAdopt({ kind: "signature", fieldId: "" }) : setConsentOpen(true))}>
              Adopt signature
            </button>
          ) : !canFinish ? (
            <button className="btn primary lg" onClick={() => (!consented ? setConsentOpen(true) : started ? next() : goTo(remaining[0]))} disabled={!remaining.length && consented}>
              {!started ? (
                <>
                  Start <ArrowDown size={16} />
                </>
              ) : (
                <>
                  Next field <ChevronRight size={16} />
                </>
              )}
            </button>
          ) : (
            <button className="btn primary lg" onClick={() => setFinishOpen(true)}>
              <FileCheck2 size={16} /> Finish
            </button>
          )}
        </div>
      </div>

      {/* Consent (ESIGN Act §101(c) consumer disclosure) */}
      <Modal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        title="Review and agree to sign electronically"
        subtitle={`${doc.senderName} sent you “${doc.title}” to sign.`}
        footer={
          <>
            <button className="btn ghost" onClick={() => (setConsentOpen(false), setDeclineOpen(true))} style={{ marginRight: "auto" }}>
              Decline
            </button>
            <button
              className="btn primary"
              disabled={!agree || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/api/sign/${enc}`, { json: { action: "consent" } });
                  setConsented(true);
                  setConsentOpen(false);
                  setTimeout(() => goTo(remaining[0] ?? ordered[0]), 200);
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner />} Continue
            </button>
          </>
        }
      >
        <div className="stack">
          <div className="consent-box" tabIndex={0}>
            <ConsentText company={p.brand.company || doc.senderName} brand={p.brand.name} />
          </div>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I agree to use electronic records and signatures, and I can access and keep this document electronically.</span>
          </label>
          {err && <div className="note bad">{err}</div>}
        </div>
      </Modal>

      {adopt && (
        <AdoptDialog
          open
          kind={adopt.kind}
          name={recipient.name}
          onClose={() => setAdopt(null)}
          onAdopt={(a) => {
            if (adopt.kind === "signature") setSig(a);
            else setIni(a);
            const fid = adopt.fieldId;
            setAdopt(null);
            if (fid) applySigned(adopt.kind, fid);
          }}
        />
      )}

      <Modal
        open={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet ? sheet.label || (sheet.type === "name" ? "Full name" : sheet.type === "email" ? "Email address" : "Text") : ""}
        footer={
          <button className="btn primary block" onClick={() => setSheet(null)}>
            Done
          </button>
        }
      >
        {sheet && (
          <input
            autoFocus
            type={sheet.type === "email" ? "email" : "text"}
            value={values[sheet.id] ?? ""}
            placeholder={sheet.placeholder ?? ""}
            maxLength={sheet.options.maxLength ?? (sheet.type === "name" ? 120 : 500)}
            onChange={(e) => setValues((s) => ({ ...s, [sheet.id]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && setSheet(null)}
            style={{ height: 44, fontSize: 16 }}
          />
        )}
      </Modal>

      <Modal
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        title="Finish signing?"
        subtitle="Your signature will be applied to the document."
        footer={
          <>
            <button className="btn" onClick={() => setFinishOpen(false)}>
              Review again
            </button>
            <button className="btn primary" disabled={busy} onClick={finish}>
              {busy ? <Spinner /> : <ShieldCheck size={15} />} Sign document
            </button>
          </>
        }
      >
        <div className="stack">
          <p className="small dim" style={{ lineHeight: 1.6 }}>
            By selecting <b>Sign document</b>, you agree that your electronic signature is the legal equivalent of your handwritten signature on “{doc.title}”, and that you intend to sign it.
          </p>
          {sig && (
            <div className="row nowrap" style={{ gap: 12, padding: 10, border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sig.png} alt="Your signature" style={{ maxHeight: 44, maxWidth: 220 }} />
              <span className="xs muted" style={{ marginLeft: "auto" }}>
                {recipient.name}
                <br />
                {today}
              </span>
            </div>
          )}
          {err && <div className="note bad">{err}</div>}
        </div>
      </Modal>

      <DeclineDialog open={declineOpen} onClose={() => setDeclineOpen(false)} token={enc} onDone={() => setDone("declined")} />
    </div>
  );
}

function SigningField({ f, hPx, scale, touch, color, value, done, current, showTag, today, sig, onActivate, onText, onFocus }: { f: SignField; hPx: number; scale: number; touch: boolean; color: string; value?: string; done: boolean; current: boolean; showTag: boolean; today: string; sig: Adopted | null; onActivate: () => void; onText: (v: string) => void; onFocus: () => void }) {
  const Icon = FIELD_ICON[f.type];
  const fs = f.options.fontSize ? Math.max(8, f.options.fontSize * scale) : fieldFontPx(hPx, 15);
  const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, ["--c" as string]: color, ["--fs" as string]: `${fs}px` };
  const cls = `sf ${f.type} ${f.required && f.type !== "date" ? "req" : ""} ${done && (f.type !== "checkbox" || value === "true") && f.type !== "date" ? "done" : ""} ${current ? "cur" : ""} ${f.type === "date" ? "readonly" : ""}`;
  const label = f.label || f.placeholder;
  const tag = showTag ? <span className="start-tag">{done ? "DONE" : f.required ? "REQUIRED" : "OPTIONAL"}</span> : null;

  if (f.type === "text" || f.type === "name" || f.type === "email") {
    const coarse = touch || hPx < 26;
    return (
      <div className={cls} style={style} data-sf={f.id} onClick={coarse ? onActivate : undefined}>
        {tag}
        {coarse ? (
          <span className={value ? "val" : "ph"}>{value || label || (f.type === "name" ? "Full name" : f.type === "email" ? "Email" : "Enter text")}</span>
        ) : (
          <input value={value ?? ""} onChange={(e) => onText(e.target.value)} onFocus={onFocus} placeholder={label || (f.type === "name" ? "Full name" : f.type === "email" ? "Email" : "Enter text")} maxLength={f.options.maxLength ?? (f.type === "name" ? 120 : 500)} aria-label={label || f.type} aria-required={f.required} type={f.type === "email" ? "email" : "text"} />
        )}
      </div>
    );
  }
  if (f.type === "date")
    return (
      <div className={cls} style={style} data-sf={f.id} title="Filled in automatically when you sign">
        <span className="val">{today}</span>
      </div>
    );
  if (f.type === "checkbox")
    return (
      <div className={cls} style={style} data-sf={f.id} onClick={onActivate} role="checkbox" aria-checked={value === "true"} tabIndex={0} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), onActivate())}>
        {tag}
        <span className="box">{value === "true" && <Check size={Math.max(8, hPx * 0.6)} strokeWidth={3} color="#111" />}</span>
      </div>
    );
  return (
    <div className={cls} style={style} data-sf={f.id} onClick={onActivate} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onActivate())} aria-label={f.type === "signature" ? "Sign here" : "Initial here"}>
      {tag}
      {value === "signed" && sig ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sig.png} alt="" />
      ) : (
        <span className="ph">
          <Icon size={Math.min(16, hPx * 0.5)} /> {hPx > 16 && (f.type === "signature" ? "Sign" : "Initial")}
        </span>
      )}
    </div>
  );
}

function DeclineDialog({ open, onClose, token, onDone }: { open: boolean; onClose: () => void; token: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Decline to sign?"
      subtitle="The sender will be notified and the request will close for everyone."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn danger solid"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await api(`/api/sign/${token}`, { json: { action: "decline", reason } });
                onDone();
              } catch (e) {
                setErr((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />} Decline
          </button>
        </>
      }
    >
      <label className="f">
        Reason <span className="hint">Optional, shared with the sender.</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
      </label>
      {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

/** Consumer disclosure for electronic records and signatures (ESIGN Act / UETA). */
export function ConsentText({ company, brand }: { company: string; brand: string }) {
  return (
    <>
      <h4>Electronic record and signature disclosure</h4>
      <p>
        {company} uses {brand} to send you documents and collect your signature electronically. Before you continue, please read this disclosure. If you agree, select the checkbox and continue.
      </p>
      <h4>Your consent</h4>
      <p>By agreeing, you consent to receive this document and related notices electronically, and to sign it with an electronic signature that has the same effect as a handwritten signature. Your consent applies to this transaction.</p>
      <h4>Paper copies</h4>
      <p>You may ask {company} for a paper copy of any document you sign electronically. Contact them by replying to the invitation email. They may charge a reasonable fee.</p>
      <h4>Withdrawing consent</h4>
      <p>You may withdraw your consent before signing by selecting “Decline to sign”. Withdrawing consent does not affect the legal effect of anything signed before you withdrew.</p>
      <h4>Keeping your contact details current</h4>
      <p>To change the email address where you receive documents, contact {company}.</p>
      <h4>What you need</h4>
      <p>A current web browser (Chrome, Safari, Edge or Firefox) on a computer, tablet or phone, an email account, and the ability to view and save or print PDF files. By continuing, you confirm you can access this document electronically.</p>
    </>
  );
}
