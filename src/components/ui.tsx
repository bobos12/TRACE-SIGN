"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { APP_TIME_ZONE, formatPacific } from "@/lib/geometry";

// ── Status ──────────────────────────────────────────────────────────────

const TONE: Record<string, string> = {
  sent: "info", delivered: "ok", signed: "ok", completed: "ok", ok: "ok", reply: "info",
  queued: "neutral", sending: "info", opened: "info", viewed: "info", pending: "neutral", unknown: "neutral", auto_reply: "neutral",
  retrying: "warn", expired: "warn", cancelled: "neutral", voided: "neutral", rewritten: "warn", waiting: "accent",
  failed: "bad", bounced: "bad", declined: "bad", rejected: "bad", bounce: "bad", draft: "draft",
};

const DOC_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Out for signature",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  voided: "Cancelled",
};
const RECIP_LABEL: Record<string, string> = { pending: "Not yet sent", sent: "Sent", opened: "Viewed", signed: "Signed", declined: "Declined" };

export function Pill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill ${TONE[status] ?? "neutral"}`}>{label ?? status.replace(/_/g, " ")}</span>;
}
export function DocStatus({ status, waitingOnMe }: { status: string; waitingOnMe?: boolean }) {
  if (waitingOnMe) return <Pill status="waiting" label="Needs your signature" />;
  return <Pill status={status} label={DOC_LABEL[status] ?? status} />;
}
export function RecipientStatus({ status }: { status: string }) {
  return <Pill status={status} label={RECIP_LABEL[status] ?? status} />;
}

/** Formats timestamps in the viewer's own time zone (avoids server/client TZ mismatch). */
export function When({ at, empty = "—", mode = "datetime" }: { at: string | Date | null | undefined; empty?: string; mode?: "datetime" | "date" | "relative" }) {
  const iso = at ? new Date(at).toISOString() : null;
  const [txt, setTxt] = useState(iso ? iso.slice(0, 10) : empty);
  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    if (mode === "relative") setTxt(relative(d));
    else setTxt(formatPacific(d, { time: mode !== "date" }));
  }, [iso, mode]);
  return iso ? (
    <time dateTime={iso} title={formatPacific(iso)}>
      {txt}
    </time>
  ) : (
    <span className="muted">{empty}</span>
  );
}

export function relative(d: Date): string {
  const s = (Date.now() - d.getTime()) / 1000;
  const fut = s < 0;
  const a = Math.abs(s);
  const f = (n: number, u: string) => (fut ? `in ${n}${u}` : `${n}${u} ago`);
  if (a < 60) return fut ? "in a moment" : "just now";
  if (a < 3600) return f(Math.round(a / 60), "m");
  if (a < 86400) return f(Math.round(a / 3600), "h");
  if (a < 86400 * 7) return f(Math.round(a / 86400), "d");
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: APP_TIME_ZONE }).format(d);
}

export function initials(name: string, email?: string) {
  const src = name.trim() || email || "?";
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({ name, email, color = "#71717a", size }: { name: string; email?: string; color?: string; size?: "lg" }) {
  return (
    <span className={`avatar ${size ?? ""}`} style={{ background: color }} title={email ? `${name} <${email}>` : name}>
      {initials(name, email)}
    </span>
  );
}

export function Progress({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`progress ${total && value === total ? "done" : ""}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-ic">{icon}</div>}
      <h3>{title}</h3>
      {children && <div style={{ maxWidth: 380 }}>{children}</div>}
      {action}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

// ── Data ────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public problems?: { recipientId?: string; message: string }[],
  ) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: init?.json !== undefined ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; problems?: { message: string }[] };
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.problems);
  return data;
}

// ── Toasts ──────────────────────────────────────────────────────────────

type Toast = { id: number; text: string; tone: "ok" | "bad" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "bad") => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "bad" ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === "bad" ? "bad" : ""}`}>
            {t.tone === "bad" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, subtitle, children, footer, wide, labelledBy }: { open: boolean; onClose: () => void; title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Portals only exist in the browser: render after mount so hydration markup matches the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open || !mounted) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])");
    first?.focus();
    const ov = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = ov;
      prev?.focus?.();
    };
  }, [open, onClose, mounted]);
  if (!open || !mounted) return null;
  const id = labelledBy ?? "modal-title";
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={id} style={{ fontSize: 16 }}>
              {title}
            </h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close" data-close>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ── Menu ────────────────────────────────────────────────────────────────

export function Menu({ trigger, children, align = "right", up }: { trigger: (p: { open: boolean; toggle: () => void }) => React.ReactNode; children: React.ReactNode; align?: "left" | "right"; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={`menu ${align === "left" ? "left" : ""} ${up ? "up" : ""}`} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="spin" />;
}

/** A button that POSTs to an endpoint, then refreshes the page. */
export function ActionButton({ url, body, label, className = "btn sm", confirm: confirmText, onDone, icon, method }: { url: string; body?: unknown; label: string; className?: string; confirm?: string; onDone?: (r: unknown) => void; icon?: React.ReactNode; method?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="row" style={{ gap: 6 }}>
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          if (confirmText && !window.confirm(confirmText)) return;
          setBusy(true);
          setErr(null);
          try {
            const r = await api(url, { json: body ?? {}, method });
            onDone?.(r);
            window.location.reload();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : icon}
        {busy ? "Working…" : label}
      </button>
      {err && <span className="small" style={{ color: "var(--bad)" }}>{err}</span>}
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
