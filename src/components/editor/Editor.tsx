"use client";
// TRACE.SIGN document preparation editor.
//
// Field geometry is kept as fractions (0..1) of the page *as displayed*, origin top-left
// (see lib/geometry.ts). Screen pixels are converted at the moment of interaction using
// the page element's bounding box, so positions are independent of zoom, screen size and
// device pixel ratio, and map exactly onto the PDF when it's finalized.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, ChevronDown, ChevronUp, CircleAlert, Copy, Eye, FileStack, Lock, Maximize2, MoreHorizontal, Plus, Redo2, Send, Trash2, Undo2, UserPlus, Users, X, ZoomIn, ZoomOut, LayoutPanelLeft, SlidersHorizontal, PenLine,
} from "lucide-react";
import {
  DATE_FORMATS, DEFAULT_SIZE, EMAIL_RE, FIELD_LABEL, FIELD_TYPES, MIN_SIZE_PT, RECIPIENT_COLORS, normalizeRect, type FieldOptions, type FieldType, type PageInfo, formatDate,
} from "@/lib/geometry";
import { api, ApiError, Avatar, Menu, Modal, Spinner, Switch, useToast } from "@/components/ui";
import { PdfPage, useFitScale, usePdf } from "@/components/pdf/PdfPages";
import { FIELD_HINT, FIELD_ICON, fieldFontPx } from "./fieldMeta";

export type Mode = "document" | "template";

export interface ERecipient {
  id: string;
  name: string;
  email: string;
  roleLabel: string | null;
  color: string;
  order: number;
}
export interface EField {
  id: string;
  recipientId: string;
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
interface EMeta {
  title: string;
  message: string;
  description?: string | null;
  signingOrder: "parallel" | "sequential";
  expiresInDays: number;
  reminderEveryDays: number;
  maxReminders: number;
}
interface Loaded {
  document: EMeta & { id: string; status: string; pageCount: number; pages: PageInfo[]; fileName: string; message: string | null };
  recipients: ERecipient[];
  fields: (EField & { options: FieldOptions })[];
}

/** 128-bit random id as 32 hex chars (matches the server's id format). */
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const PX_PER_PT = 96 / 72;
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5];

type Drag =
  | { kind: "move"; id: string; startX: number; startY: number; orig: EField; offX: number; offY: number; snapshot: EField[] }
  | { kind: "resize"; id: string; handle: "nw" | "ne" | "sw" | "se"; startX: number; startY: number; orig: EField; snapshot: EField[] };

export function Editor({ mode, id, me, defaultDateFormat = "MMM d, yyyy", timeZone = "America/Los_Angeles" }: { mode: Mode; id: string; me: { name: string; email: string }; defaultDateFormat?: string; timeZone?: string }) {
  const router = useRouter();
  const toast = useToast();
  const base = mode === "template" ? `/api/admin/templates/${id}` : `/api/admin/documents/${id}`;

  // ── State ──────────────────────────────────────────────────────────
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<EMeta>({ title: "", message: "", signingOrder: "parallel", expiresInDays: 30, reminderEveryDays: 3, maxReminders: 3 });
  const [recipients, setRecipients] = useState<ERecipient[]>([]);
  const [fields, setFieldsRaw] = useState<EField[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [armed, setArmed] = useState<FieldType | null>(null);
  const [editingRecipient, setEditingRecipient] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ type: FieldType; x: number; y: number; w: number; h: number } | null>(null);
  const [hoverPage, setHoverPage] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [preview, setPreview] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"left" | "right" | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; error?: string; at?: Date }>({ state: "idle" });
  const undo = useRef<EField[][]>([]);
  const redo = useRef<EField[][]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const pages = loaded?.document.pages ?? [];
  const { doc: pdf, error: pdfErr } = usePdf(loaded ? `${base}/file?which=original` : null);
  const fit = useFitScale(canvasRef, pages, { max: 1.6 * PX_PER_PT, padding: 96 });
  const scale = zoom === "fit" ? fit : zoom * PX_PER_PT;

  const setFields = useCallback((next: EField[] | ((f: EField[]) => EField[]), opts: { commit?: boolean } = { commit: true }) => {
    setFieldsRaw((cur) => {
      const v = typeof next === "function" ? next(cur) : next;
      if (opts.commit && v !== cur) {
        undo.current.push(cur);
        if (undo.current.length > 80) undo.current.shift();
        redo.current = [];
      }
      return v;
    });
  }, []);

  // ── Load ───────────────────────────────────────────────────────────
  useEffect(() => {
    api<Loaded>(base)
      .then((d) => {
        if (mode === "document" && d.document.status !== "draft") {
          router.replace(`/admin/documents/${id}`);
          return;
        }
        setLoaded(d);
        setMeta({
          title: d.document.title,
          message: d.document.message ?? "",
          description: (d.document as unknown as { description?: string }).description ?? null,
          signingOrder: d.document.signingOrder as EMeta["signingOrder"],
          expiresInDays: d.document.expiresInDays,
          reminderEveryDays: d.document.reminderEveryDays,
          maxReminders: d.document.maxReminders,
        });
        setRecipients(d.recipients.map((r) => ({ id: r.id, name: r.name, email: r.email, roleLabel: r.roleLabel, color: r.color, order: r.order })));
        setFieldsRaw(d.fields.map((f) => ({ ...f, type: f.type as FieldType, options: f.options ?? {} })));
        setActive(d.recipients[0]?.id ?? null);
        if (!d.recipients.length) setEditingRecipient("new");
      })
      .catch((e: Error) => setLoadErr(e.message));
  }, [base, id, mode, router]);

  // ── Autosave ───────────────────────────────────────────────────────
  const latest = useRef({ meta, recipients, fields });
  latest.current = { meta, recipients, fields };
  const seq = useRef(0);
  const dirty = useRef(false);
  const doSave = useCallback(async () => {
    const n = ++seq.current;
    const { meta: m, recipients: rs, fields: fs } = latest.current;
    setSave({ state: "saving" });
    try {
      await api(base, {
        method: "PUT",
        json: {
          title: m.title.trim() || "Untitled document",
          message: m.message || null,
          description: m.description ?? null,
          signingOrder: m.signingOrder,
          expiresInDays: m.expiresInDays,
          reminderEveryDays: m.reminderEveryDays,
          maxReminders: m.maxReminders,
          recipients: rs.map((r) => ({ id: r.id, name: r.name.trim(), email: r.email.trim().toLowerCase(), roleLabel: r.roleLabel?.trim() || null, color: r.color, order: r.order })),
          fields: fs.map((f) => ({
            id: f.id,
            recipientId: f.recipientId,
            type: f.type,
            page: f.page,
            x: f.x,
            y: f.y,
            w: f.w,
            h: f.h,
            required: f.required,
            label: f.label || null,
            placeholder: f.placeholder || null,
            defaultValue: f.defaultValue || null,
            options: Object.fromEntries(Object.entries(f.options ?? {}).filter(([k, v]) => ["dateFormat", "fontSize", "maxLength"].includes(k) && v !== undefined && v !== null && v !== "")),
          })),
        },
      });
      if (n === seq.current) {
        dirty.current = false;
        setSave({ state: "saved", at: new Date() });
      }
      return true;
    } catch (e) {
      if (n === seq.current) setSave({ state: "error", error: (e as Error).message });
      return false;
    }
  }, [base]);

  const first = useRef(true);
  useEffect(() => {
    if (!loaded) return;
    if (first.current) {
      first.current = false;
      return;
    }
    if (draggingId) return; // save once the gesture ends
    dirty.current = true;
    const t = setTimeout(() => void doSave(), 700);
    return () => clearTimeout(t);
  }, [meta, recipients, fields, loaded, doSave, draggingId]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────
  const recipientById = useMemo(() => new Map(recipients.map((r) => [r.id, r])), [recipients]);
  const activeRecipient = active ? recipientById.get(active) ?? null : null;
  const sel = fields.find((f) => f.id === selected) ?? null;
  const ordered = useMemo(() => [...recipients].sort((a, b) => a.order - b.order), [recipients]);

  const pageEls = () => Array.from(canvasRef.current?.querySelectorAll<HTMLElement>(".ed-pages > .pg[data-page]") ?? []);
  const pageAt = (cx: number, cy: number) => {
    for (const el of pageEls()) {
      const r = el.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return { index: Number(el.dataset.page), u: (cx - r.left) / r.width, v: (cy - r.top) / r.height, rect: r };
    }
    return null;
  };
  const pageRect = (i: number) => pageEls().find((e) => Number(e.dataset.page) === i)?.getBoundingClientRect() ?? null;

  const ensureRecipient = (): ERecipient | null => {
    if (activeRecipient) return activeRecipient;
    if (recipients[0]) {
      setActive(recipients[0].id);
      return recipients[0];
    }
    toast(mode === "template" ? "Add a role first, then place fields for it." : "Add a recipient first, then place their fields.", "bad");
    setEditingRecipient("new");
    setSheet("left");
    return null;
  };

  const placeField = (type: FieldType, page: number, u: number, v: number) => {
    const r = ensureRecipient();
    if (!r) return;
    const info = pages[page];
    const sz = DEFAULT_SIZE[type];
    const w = sz.w / info.w;
    const h = sz.h / info.h;
    const rect = normalizeRect({ x: u - w / 2, y: v - h / 2, w, h }, info);
    const f: EField = {
      id: uid(),
      recipientId: r.id,
      type,
      page,
      ...rect,
      required: type !== "checkbox" && type !== "text",
      label: null,
      placeholder: type === "text" ? "Enter text" : null,
      defaultValue: null,
      options: {},
    };
    setFields((fs) => [...fs, f]);
    setSelected(f.id);
    setArmed(null);
  };

  // ── Palette drag (or tap to arm) ───────────────────────────────────
  const startToolDrag = (type: FieldType, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const sz = DEFAULT_SIZE[type];
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) moved = true;
      if (!moved) return;
      setGhost({ type, x: ev.clientX, y: ev.clientY, w: sz.w * scale, h: sz.h * scale });
      setHoverPage(pageAt(ev.clientX, ev.clientY)?.index ?? null);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGhost(null);
      setHoverPage(null);
      if (!moved) {
        setArmed((a) => (a === type ? null : type));
        setSheet(null);
        return;
      }
      const hit = pageAt(ev.clientX, ev.clientY);
      if (hit) placeField(type, hit.index, hit.u, hit.v);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".fld")) return;
    if (armed) {
      const hit = pageAt(e.clientX, e.clientY);
      if (hit) placeField(armed, hit.index, hit.u, hit.v);
      return;
    }
    setSelected(null);
  };

  // ── Move / resize placed fields ────────────────────────────────────
  const startFieldDrag = (f: EField, e: React.PointerEvent, handle?: "nw" | "ne" | "sw" | "se") => {
    if (preview || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(f.id);
    setActive(f.recipientId);
    const r = pageRect(f.page);
    if (!r) return;
    dragRef.current = handle
      ? { kind: "resize", id: f.id, handle, startX: e.clientX, startY: e.clientY, orig: { ...f }, snapshot: fields }
      : { kind: "move", id: f.id, startX: e.clientX, startY: e.clientY, orig: { ...f }, offX: e.clientX - (r.left + f.x * r.width), offY: e.clientY - (r.top + f.y * r.height), snapshot: fields };
    let changed = false;

    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (!changed && Math.hypot(dx, dy) < 3) return;
      if (!changed) setDraggingId(d.id);
      changed = true;
      const o = d.orig;
      const info = pages[o.page];
      const du = dx / r.width;
      const dv = dy / r.height;
      let next: { x: number; y: number; w: number; h: number };
      if (d.kind === "move") {
        next = normalizeRect({ x: o.x + du, y: o.y + dv, w: o.w, h: o.h }, info);
        setHoverPage(pageAt(ev.clientX, ev.clientY)?.index ?? null);
      } else {
        const minW = MIN_SIZE_PT / info.w;
        const minH = MIN_SIZE_PT / info.h;
        let left = o.x;
        let top = o.y;
        let right = o.x + o.w;
        let bottom = o.y + o.h;
        if (d.handle.includes("w")) left = Math.min(right - minW, Math.max(0, o.x + du));
        if (d.handle.includes("e")) right = Math.max(left + minW, Math.min(1, o.x + o.w + du));
        if (d.handle.includes("n")) top = Math.min(bottom - minH, Math.max(0, o.y + dv));
        if (d.handle.includes("s")) bottom = Math.max(top + minH, Math.min(1, o.y + o.h + dv));
        next = { x: left, y: top, w: right - left, h: bottom - top };
        if (o.type === "checkbox") {
          const side = Math.max(next.w * info.w, next.h * info.h);
          next = normalizeRect({ x: next.x, y: next.y, w: side / info.w, h: side / info.h }, info);
        }
      }
      setFieldsRaw((fs) => fs.map((x) => (x.id === d.id ? { ...x, ...next } : x)));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = dragRef.current;
      dragRef.current = null;
      setDraggingId(null);
      setHoverPage(null);
      if (!d || !changed) return;
      // Dropped onto a different page? Move it there, keeping its physical size.
      if (d.kind === "move") {
        const hit = pageAt(ev.clientX, ev.clientY);
        if (hit && hit.index !== d.orig.page) {
          const from = pages[d.orig.page];
          const to = pages[hit.index];
          const w = (d.orig.w * from.w) / to.w;
          const h = (d.orig.h * from.h) / to.h;
          const x = (ev.clientX - hit.rect.left - d.offX * (hit.rect.width / r.width)) / hit.rect.width;
          const y = (ev.clientY - hit.rect.top - d.offY * (hit.rect.height / r.height)) / hit.rect.height;
          const nr = normalizeRect({ x, y, w, h }, to);
          setFieldsRaw((fs) => fs.map((f2) => (f2.id === d.id ? { ...f2, page: hit.index, ...nr } : f2)));
        }
      }
      undo.current.push(d.snapshot);
      redo.current = [];
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const updateField = (fid: string, patch: Partial<EField>) => setFields((fs) => fs.map((f) => (f.id === fid ? { ...f, ...patch } : f)));
  const removeField = (fid: string) => {
    setFields((fs) => fs.filter((f) => f.id !== fid));
    setSelected(null);
  };
  const duplicateField = (fid: string) => {
    const f = fields.find((x) => x.id === fid);
    if (!f) return;
    const info = pages[f.page];
    const off = 12;
    const n: EField = { ...f, id: uid(), ...normalizeRect({ x: f.x + off / info.w, y: f.y + off / info.h, w: f.w, h: f.h }, info) };
    setFields((fs) => [...fs, n]);
    setSelected(n.id);
  };

  // ── Keyboard ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) return;
      if (document.querySelector(".modal-back")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const stack = e.shiftKey ? redo.current : undo.current;
        const other = e.shiftKey ? undo.current : redo.current;
        const prev = stack.pop();
        if (prev) {
          setFieldsRaw((cur) => {
            other.push(cur);
            return prev;
          });
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        const prev = redo.current.pop();
        if (prev) setFieldsRaw((cur) => (undo.current.push(cur), prev));
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        stepZoom(1);
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        stepZoom(-1);
        return;
      }
      if (e.key === "Escape") {
        setArmed(null);
        setSelected(null);
        return;
      }
      if (!sel) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeField(sel.id);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateField(sel.id);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const info = pages[sel.page];
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        updateField(sel.id, normalizeRect({ x: sel.x + dx / info.w, y: sel.y + dy / info.h, w: sel.w, h: sel.h }, info));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const currentPct = Math.round((scale / PX_PER_PT) * 100);
  const stepZoom = (dir: 1 | -1) => {
    const cur = scale / PX_PER_PT;
    const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.01) : [...ZOOMS].reverse().find((z) => z < cur - 0.01);
    if (next) setZoom(next);
  };

  // ── Recipients ─────────────────────────────────────────────────────
  const nextColor = () => RECIPIENT_COLORS.find((c) => !recipients.some((r) => r.color === c)) ?? RECIPIENT_COLORS[recipients.length % RECIPIENT_COLORS.length];
  const addRecipient = (r: Omit<ERecipient, "id" | "color" | "order">) => {
    const n: ERecipient = { ...r, id: uid(), color: nextColor(), order: (Math.max(0, ...recipients.map((x) => x.order)) || 0) + 1 };
    setRecipients((rs) => [...rs, n]);
    setActive(n.id);
    setEditingRecipient(null);
    return n;
  };
  const removeRecipient = (rid: string) => {
    const n = fields.filter((f) => f.recipientId === rid).length;
    if (n && !window.confirm(`Remove this recipient and their ${n} field${n === 1 ? "" : "s"}?`)) return;
    setRecipients((rs) => rs.filter((r) => r.id !== rid));
    setFields((fs) => fs.filter((f) => f.recipientId !== rid));
    if (active === rid) setActive(recipients.find((r) => r.id !== rid)?.id ?? null);
  };
  const moveRecipient = (rid: string, dir: -1 | 1) => {
    const list = [...ordered];
    const i = list.findIndex((r) => r.id === rid);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setRecipients(list.map((r, k) => ({ ...r, order: k + 1 })));
  };
  const setSigningOrder = (o: EMeta["signingOrder"]) => {
    setMeta((m) => ({ ...m, signingOrder: o }));
    if (o === "sequential") setRecipients(ordered.map((r, k) => ({ ...r, order: k + 1 })));
  };

  // ── Validation (mirrors the server; the server re-checks) ──────────
  const problems = useMemo(() => {
    const out: { recipientId?: string; message: string }[] = [];
    if (!recipients.length) out.push({ message: mode === "template" ? "Add at least one role." : "Add at least one recipient." });
    const seen = new Map<string, number>();
    for (const r of recipients) {
      const who = r.name || r.roleLabel || r.email || "A recipient";
      if (mode === "document") {
        if (!r.name.trim()) out.push({ recipientId: r.id, message: `${who}: add a name.` });
        if (!EMAIL_RE.test(r.email.trim())) out.push({ recipientId: r.id, message: `${who}: add a valid email.` });
        seen.set(r.email.trim().toLowerCase(), (seen.get(r.email.trim().toLowerCase()) ?? 0) + 1);
      }
      if (!fields.some((f) => f.recipientId === r.id && (f.type === "signature" || f.type === "initials"))) out.push({ recipientId: r.id, message: `${who} needs a signature or initials field.` });
    }
    for (const [e, n] of seen) if (e && n > 1) out.push({ message: `${e} is listed twice.` });
    return out;
  }, [recipients, fields, mode]);

  // ── Render ─────────────────────────────────────────────────────────
  if (loadErr)
    return (
      <div className="center-fill">
        <div className="note bad">{loadErr}</div>
      </div>
    );
  if (!loaded)
    return (
      <div className="ed" style={{ placeItems: "center", display: "grid" }}>
        <div className="spinner" />
      </div>
    );

  const previewRecipient = preview ? recipientById.get(preview) : null;
  const backHref = mode === "template" ? "/admin/templates" : "/admin/documents?view=drafts";

  return (
    <div className="ed" onDragOver={(e) => e.preventDefault()}>
      {/* ── Top bar ── */}
      <header className="ed-top">
        <Link href={backHref} className="btn ghost icon" aria-label="Back" onClick={() => void doSave()}>
          <ArrowLeft size={17} />
        </Link>
        <div className="ed-title">
          <span className="tag hide-m">{mode === "template" ? "Template" : "Draft"}</span>
          <input aria-label={mode === "template" ? "Template name" : "Document name"} value={meta.title} maxLength={200} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} placeholder="Untitled document" />
          <span className="ed-save hide-m" aria-live="polite">
            {save.state === "saving" && (
              <>
                <Spinner size={12} /> Saving…
              </>
            )}
            {save.state === "saved" && (
              <>
                <Check size={12} /> Saved
              </>
            )}
            {save.state === "error" && (
              <span style={{ color: "var(--bad)" }} title={save.error}>
                <CircleAlert size={12} style={{ verticalAlign: -2 }} /> Not saved: {save.error}
              </span>
            )}
          </span>
        </div>
        <Menu
          trigger={({ toggle }) => (
            <button className="btn hide-m" onClick={toggle} disabled={!recipients.length}>
              <Eye size={15} /> Preview <ChevronDown size={13} />
            </button>
          )}
        >
          <div className="xs muted" style={{ padding: "6px 10px" }}>See exactly what each signer sees</div>
          {ordered.map((r) => (
            <button key={r.id} onClick={() => setPreview(r.id)}>
              <span className="dot" style={{ background: r.color }} /> {r.name || r.roleLabel || r.email || "Recipient"}
            </button>
          ))}
        </Menu>
        <Menu
          trigger={({ toggle }) => (
            <button className="btn icon" onClick={toggle} aria-label="More">
              <MoreHorizontal size={16} />
            </button>
          )}
        >
          {mode === "document" && (
            <button onClick={() => setTplOpen(true)}>
              <FileStack size={15} /> Save as template
            </button>
          )}
          <button
            onClick={() => {
              const prev = undo.current.pop();
              if (prev) setFieldsRaw((cur) => (redo.current.push(cur), prev));
            }}
          >
            <Undo2 size={15} /> Undo <span className="spacer" />
            <span className="kbd">⌘Z</span>
          </button>
          <button
            onClick={() => {
              const prev = redo.current.pop();
              if (prev) setFieldsRaw((cur) => (undo.current.push(cur), prev));
            }}
          >
            <Redo2 size={15} /> Redo <span className="spacer" />
            <span className="kbd">⇧⌘Z</span>
          </button>
          <hr />
          <button
            className="danger"
            onClick={async () => {
              if (!window.confirm(mode === "template" ? "Delete this template?" : "Delete this draft?")) return;
              dirty.current = false;
              await api(base, { method: "DELETE" });
              router.push(backHref);
            }}
          >
            <Trash2 size={15} /> {mode === "template" ? "Delete template" : "Delete draft"}
          </button>
        </Menu>
        {mode === "document" ? (
          <button
            className="btn primary"
            onClick={async () => {
              await doSave();
              setSendOpen(true);
            }}
          >
            <Send size={15} /> <span className="hide-m">Review &amp;</span> Send
          </button>
        ) : (
          <button
            className="btn primary"
            onClick={async () => {
              if (await doSave()) {
                toast("Template saved");
                router.push(`/admin/templates?use=${id}`);
              }
            }}
          >
            <Check size={15} /> Done
          </button>
        )}
      </header>

      <div className="ed-body">
        {/* ── Left: recipients + field palette ── */}
        <aside className={`ed-left ${sheet === "left" ? "show" : ""}`} aria-label="Recipients and fields">
          <div className="ed-sec">
            <h3>
              <Users size={13} /> {mode === "template" ? "Roles" : "Recipients"}
              <span className="spacer" />
            </h3>
            {recipients.length > 1 && (
              <div className="seg" style={{ marginBottom: 10, width: "100%" }}>
                <button className={meta.signingOrder === "parallel" ? "on" : ""} style={{ flex: 1, justifyContent: "center" }} onClick={() => setSigningOrder("parallel")}>
                  Any order
                </button>
                <button className={meta.signingOrder === "sequential" ? "on" : ""} style={{ flex: 1, justifyContent: "center" }} onClick={() => setSigningOrder("sequential")}>
                  In order
                </button>
              </div>
            )}
            <div className="stack tight" style={{ gap: 4 }}>
              {ordered.map((r, i) => {
                const n = fields.filter((f) => f.recipientId === r.id).length;
                const bad = problems.some((p) => p.recipientId === r.id);
                return (
                  <div key={r.id}>
                    <div
                      className={`recip ${active === r.id ? "on" : ""}`}
                      onClick={() => setActive(r.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && setActive(r.id)}
                      aria-pressed={active === r.id}
                    >
                      {meta.signingOrder === "sequential" && recipients.length > 1 && <span className="order">{i + 1}</span>}
                      <span className="recip-swatch" style={{ background: r.color }} />
                      <div className="meta">
                        <div className="small strong">{r.name || r.roleLabel || <span className="muted">Unnamed</span>}</div>
                        <div className="xs muted">
                          {r.roleLabel && r.name ? `${r.roleLabel} · ` : ""}
                          {r.email || (mode === "template" ? "Filled in when used" : "No email")}
                        </div>
                      </div>
                      <span className="xs" style={{ color: bad ? "var(--bad)" : "var(--text-3)" }} title={`${n} field(s)`}>
                        {n}
                      </span>
                      <Menu
                        trigger={({ toggle }) => (
                          <button
                            className="btn ghost icon sm"
                            aria-label="Recipient options"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle();
                            }}
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        )}
                      >
                        <button onClick={() => setEditingRecipient(r.id)}>
                          <PenLine size={14} /> Edit details
                        </button>
                        {meta.signingOrder === "sequential" && (
                          <>
                            <button onClick={() => moveRecipient(r.id, -1)} disabled={i === 0}>
                              <ChevronUp size={14} /> Sign earlier
                            </button>
                            <button onClick={() => moveRecipient(r.id, 1)} disabled={i === ordered.length - 1}>
                              <ChevronDown size={14} /> Sign later
                            </button>
                          </>
                        )}
                        <hr />
                        <button className="danger" onClick={() => removeRecipient(r.id)}>
                          <Trash2 size={14} /> Remove
                        </button>
                      </Menu>
                    </div>
                    {editingRecipient === r.id && (
                      <RecipientForm
                        mode={mode}
                        initial={r}
                        onCancel={() => setEditingRecipient(null)}
                        onSave={(v) => {
                          setRecipients((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...v } : x)));
                          setEditingRecipient(null);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {editingRecipient === "new" ? (
              <RecipientForm mode={mode} initial={{ name: "", email: "", roleLabel: recipients.length ? null : mode === "template" ? "Signer 1" : null }} onCancel={() => setEditingRecipient(null)} onSave={(v) => addRecipient(v)} />
            ) : (
              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                <button className="btn sm" onClick={() => setEditingRecipient("new")} disabled={recipients.length >= 20}>
                  <UserPlus size={14} /> Add {mode === "template" ? "role" : "recipient"}
                </button>
                {mode === "document" && !recipients.some((r) => r.email === me.email) && (
                  <button className="btn ghost sm" onClick={() => addRecipient({ name: me.name, email: me.email, roleLabel: "Sender" })}>
                    <Plus size={14} /> Add me
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="ed-sec">
            <h3>
              Fields
              <span className="spacer" />
              {activeRecipient && (
                <span className="xs" style={{ color: "var(--text-2)", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5 }}>
                  for <span className="dot" style={{ background: activeRecipient.color }} /> {activeRecipient.name || activeRecipient.roleLabel || "recipient"}
                </span>
              )}
            </h3>
            <div className="palette">
              {FIELD_TYPES.map((t) => {
                const Icon = FIELD_ICON[t];
                return (
                  <button
                    key={t}
                    type="button"
                    className={`tool ${armed === t ? "armed" : ""} ${t === "signature" ? "wide" : ""}`}
                    style={{ ["--tool-c" as string]: activeRecipient?.color ?? "#71717a" }}
                    onPointerDown={(e) => startToolDrag(t, e)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setArmed((a) => (a === t ? null : t));
                      }
                    }}
                    title={FIELD_HINT[t]}
                    aria-pressed={armed === t}
                  >
                    <span className="ti">
                      <Icon size={13} />
                    </span>
                    {FIELD_LABEL[t]}
                  </button>
                );
              })}
            </div>
            <p className="xs muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
              {armed ? (
                <>
                  Click on the page to place <b>{FIELD_LABEL[armed]}</b>. <button className="linkish" onClick={() => setArmed(null)}>Cancel</button>
                </>
              ) : (
                <>Drag a field onto the document, or click it then click the page.</>
              )}
            </p>
          </div>

          {mode === "document" && (
            <div className="ed-sec">
              <h3>Ready to send</h3>
              <div className="checklist">
                {problems.length === 0 ? (
                  <div>
                    <Check size={14} className="okc" /> Every recipient has what they need.
                  </div>
                ) : (
                  problems.slice(0, 6).map((p, i) => (
                    <div key={i}>
                      <CircleAlert size={14} className="badc" style={{ marginTop: 1 }} /> {p.message}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </aside>

        {/* ── Canvas ── */}
        <div
          className="ed-canvas"
          ref={canvasRef}
          style={{ cursor: armed ? "crosshair" : undefined }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("ed-pages")) setSelected(null);
          }}
        >
          {preview && previewRecipient && (
            <div className="note info" style={{ maxWidth: 720, margin: "0 auto 18px", display: "flex", alignItems: "center", gap: 10 }}>
              <Eye size={16} />
              <span style={{ flex: 1 }}>
                Previewing as <b>{previewRecipient.name || previewRecipient.roleLabel}</b>. Only their {fields.filter((f) => f.recipientId === preview).length} field(s) are shown, exactly where they&apos;ll sign.
              </span>
              <button className="btn sm" onClick={() => setPreview(null)}>
                <X size={14} /> Exit preview
              </button>
            </div>
          )}
          {pdfErr && <div className="note bad" style={{ maxWidth: 600, margin: "0 auto 16px" }}>{pdfErr}</div>}
          <div className="ed-pages">
            {pages.map((info, i) => (
              <PdfPage key={i} doc={pdf} index={i} info={info} scale={scale} onPointerDown={onPagePointerDown} className={hoverPage === i ? "drop-target" : ""}>
                <span className="pg-num">{i + 1}</span>
                {preview
                  ? fields
                      .filter((f) => f.page === i && f.recipientId === preview)
                      .map((f) => <PreviewField key={f.id} f={f} scale={scale} info={info} recipient={recipientById.get(f.recipientId)!} dateFormat={defaultDateFormat} timeZone={timeZone} />)
                  : fields
                      .filter((f) => f.page === i)
                      .map((f) => {
                        const r = recipientById.get(f.recipientId);
                        return (
                          <FieldBox
                            key={f.id}
                            f={f}
                            color={r?.color ?? "#71717a"}
                            who={r?.name || r?.roleLabel || ""}
                            hPx={f.h * info.h * scale}
                            selected={selected === f.id}
                            dragging={draggingId === f.id}
                            onPointerDown={(e, h) => startFieldDrag(f, e, h)}
                            onDelete={() => removeField(f.id)}
                            onDuplicate={() => duplicateField(f.id)}
                          />
                        );
                      })}
              </PdfPage>
            ))}
          </div>
        </div>

        {/* ── Right: properties / settings ── */}
        <aside className={`ed-right ${sheet === "right" ? "show" : ""}`} aria-label="Properties">
          {sel ? (
            <FieldProps
              key={sel.id}
              f={sel}
              recipients={ordered}
              pages={pages}
              onChange={(p) => updateField(sel.id, p)}
              onDelete={() => removeField(sel.id)}
              onDuplicate={() => duplicateField(sel.id)}
              defaultDateFormat={defaultDateFormat}
            />
          ) : (
            <DocSettings mode={mode} meta={meta} setMeta={setMeta} fieldCount={fields.length} pageCount={pages.length} />
          )}
        </aside>
      </div>

      {/* Mobile tabs */}
      <nav className="ed-mobile-tabs">
        <button className={sheet === "left" ? "on" : ""} onClick={() => setSheet((s) => (s === "left" ? null : "left"))}>
          <LayoutPanelLeft size={18} /> Recipients &amp; fields
        </button>
        <button className={sheet === "right" ? "on" : ""} onClick={() => setSheet((s) => (s === "right" ? null : "right"))}>
          <SlidersHorizontal size={18} /> {sel ? "Field" : "Settings"}
        </button>
        <button onClick={() => (recipients[0] ? setPreview((p) => (p ? null : ordered[0].id)) : null)}>
          <Eye size={18} /> {preview ? "Exit preview" : "Preview"}
        </button>
      </nav>

      <div className="zoombar">
        <button className="btn ghost icon sm" onClick={() => stepZoom(-1)} aria-label="Zoom out">
          <ZoomOut size={15} />
        </button>
        <span>{currentPct}%</span>
        <button className="btn ghost icon sm" onClick={() => stepZoom(1)} aria-label="Zoom in">
          <ZoomIn size={15} />
        </button>
        <button className="btn ghost icon sm" onClick={() => setZoom("fit")} aria-label="Fit width" title="Fit width">
          <Maximize2 size={14} />
        </button>
        <span className="xs muted" style={{ minWidth: 0, padding: "0 8px 0 4px" }}>
          {pages.length} pg
        </span>
      </div>

      {ghost && (
        <div className="fld ghost" style={{ left: ghost.x - ghost.w / 2, top: ghost.y - ghost.h / 2, width: ghost.w, height: ghost.h, ["--c" as string]: activeRecipient?.color ?? "#71717a" }}>
          <span className="fl" style={{ ["--fs" as string]: `${fieldFontPx(ghost.h)}px` }}>
            {(() => {
              const I = FIELD_ICON[ghost.type];
              return <I size={Math.min(14, ghost.h * 0.5)} />;
            })()}
            {ghost.type !== "checkbox" && FIELD_LABEL[ghost.type]}
          </span>
        </div>
      )}

      <SendDialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        docId={id}
        meta={meta}
        setMeta={setMeta}
        recipients={ordered}
        fields={fields}
        problems={problems}
        flush={doSave}
        onSent={(r) => {
          dirty.current = false;
          if (r.signNow) window.location.href = r.signNow;
          else router.push(`/admin/documents/${id}?sent=1`);
        }}
      />
      <SaveTemplateDialog open={tplOpen} onClose={() => setTplOpen(false)} docId={id} defaultName={meta.title} flush={doSave} />
    </div>
  );
}

// ── Field on the canvas ─────────────────────────────────────────────────

function FieldBox({ f, color, who, hPx, selected, dragging, onPointerDown, onDelete, onDuplicate }: { f: EField; color: string; who: string; hPx: number; selected: boolean; dragging: boolean; onPointerDown: (e: React.PointerEvent, h?: "nw" | "ne" | "sw" | "se") => void; onDelete: () => void; onDuplicate: () => void }) {
  const Icon = FIELD_ICON[f.type];
  const label = f.label || (f.type === "text" && f.placeholder) || FIELD_LABEL[f.type];
  return (
    <div
      className={`fld ${f.type} ${selected ? "sel" : ""} ${dragging ? "dragging" : ""}`}
      style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, ["--c" as string]: color }}
      onPointerDown={(e) => onPointerDown(e)}
      title={`${FIELD_LABEL[f.type]} · ${who}${f.required ? " · required" : " · optional"}`}
      data-field={f.id}
      tabIndex={0}
      role="button"
      aria-label={`${FIELD_LABEL[f.type]} for ${who}`}
    >
      <span className="fl" style={{ ["--fs" as string]: `${fieldFontPx(hPx)}px` }}>
        <Icon size={Math.max(9, Math.min(14, hPx * 0.5))} />
        {f.type !== "checkbox" && hPx > 13 && (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {label}
            {f.required && <span className="req">*</span>}
          </span>
        )}
      </span>
      {(["nw", "ne", "sw", "se"] as const).map((h) => (
        <span key={h} className={`h ${h}`} onPointerDown={(e) => onPointerDown(e, h)} />
      ))}
      <div className="fld-bar" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={onDuplicate} title="Duplicate (⌘D)" aria-label="Duplicate field">
          <Copy size={13} />
        </button>
        <button className="danger" onClick={onDelete} title="Delete (Del)" aria-label="Delete field">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/** How a field looks to the signer (used by Preview as recipient). */
function PreviewField({ f, scale, info, recipient, dateFormat, timeZone }: { f: EField; scale: number; info: PageInfo; recipient: ERecipient; dateFormat: string; timeZone: string }) {
  const hPx = f.h * info.h * scale;
  const Icon = FIELD_ICON[f.type];
  const text =
    f.type === "date" ? formatDate(new Date(), f.options.dateFormat || dateFormat, timeZone) : f.type === "name" ? recipient.name || "Full name" : f.type === "email" ? recipient.email || "email@example.com" : f.defaultValue || f.placeholder || "";
  return (
    <div className={`sf ${f.type} ${f.required ? "req" : ""}`} style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, ["--c" as string]: recipient.color, ["--fs" as string]: `${fieldFontPx(hPx, 14)}px` }}>
      {f.type === "checkbox" ? (
        <span className="box" />
      ) : f.type === "signature" || f.type === "initials" ? (
        <span className="ph">
          <Icon size={Math.min(14, hPx * 0.5)} /> {f.type === "signature" ? "Sign here" : "Initial"}
        </span>
      ) : f.type === "date" ? (
        <span className="val" style={{ opacity: 0.55 }}>{text}</span>
      ) : (
        <span className="val" style={{ opacity: f.defaultValue || f.type === "name" || f.type === "email" ? 1 : 0.55 }}>{text}</span>
      )}
    </div>
  );
}

// ── Panels ──────────────────────────────────────────────────────────────

function RecipientForm({ mode, initial, onSave, onCancel }: { mode: Mode; initial: { name: string; email: string; roleLabel: string | null }; onSave: (v: { name: string; email: string; roleLabel: string | null }) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [role, setRole] = useState(initial.roleLabel ?? "");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="recip-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === "document") {
          if (!name.trim()) return setErr("Enter a name.");
          if (!EMAIL_RE.test(email.trim())) return setErr("Enter a valid email.");
        } else if (!role.trim()) return setErr("Name the role, e.g. Client.");
        onSave({ name: name.trim(), email: email.trim().toLowerCase(), roleLabel: role.trim() || null });
      }}
    >
      {mode === "template" && <input className="input-sm" placeholder="Role (e.g. Client)" value={role} onChange={(e) => setRole(e.target.value)} autoFocus maxLength={60} />}
      <input className="input-sm" placeholder={mode === "template" ? "Default name (optional)" : "Full name"} value={name} onChange={(e) => setName(e.target.value)} autoFocus={mode === "document"} maxLength={120} autoComplete="off" />
      <input className="input-sm" type="email" placeholder={mode === "template" ? "Default email (optional)" : "Email address"} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off" />
      {mode === "document" && <input className="input-sm" placeholder="Role (optional, e.g. Client)" value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} />}
      {err && <div className="xs" style={{ color: "var(--bad)" }}>{err}</div>}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn dark sm">Save</button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function FieldProps({ f, recipients, pages, onChange, onDelete, onDuplicate, defaultDateFormat }: { f: EField; recipients: ERecipient[]; pages: PageInfo[]; onChange: (p: Partial<EField>) => void; onDelete: () => void; onDuplicate: () => void; defaultDateFormat: string }) {
  const info = pages[f.page];
  const Icon = FIELD_ICON[f.type];
  const pt = (n: number, dim: number) => Math.round(n * dim);
  const textual = f.type === "text" || f.type === "name" || f.type === "email";
  const owner = recipients.find((r) => r.id === f.recipientId);
  return (
    <div className="ed-sec props">
      <div className="row nowrap" style={{ gap: 10 }}>
        <span className="tool" style={{ ["--tool-c" as string]: owner?.color, padding: 0, border: 0, cursor: "default", background: "none", boxShadow: "none" }}>
          <span className="ti" style={{ width: 30, height: 30 }}>
            <Icon size={15} />
          </span>
        </span>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 14 }}>{FIELD_LABEL[f.type]}</h2>
          <div className="xs muted">{FIELD_HINT[f.type]}</div>
        </div>
      </div>

      <label className="f">
        Assigned to
        <select value={f.recipientId} onChange={(e) => onChange({ recipientId: e.target.value })}>
          {recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name || r.roleLabel || r.email || "Recipient"}
            </option>
          ))}
        </select>
      </label>

      {f.type === "date" ? (
        <div className="note" style={{ fontSize: 12 }}>
          <Lock size={12} style={{ verticalAlign: -1 }} /> Filled automatically with the date this person signs. Always required.
        </div>
      ) : (
        <div className="row nowrap" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="small strong">Required</div>
            <div className="xs muted">{f.required ? "Signer must complete it" : "Signer may leave it blank"}</div>
          </div>
          <Switch checked={f.required} onChange={(v) => onChange({ required: v })} label="Required" />
        </div>
      )}

      <label className="f">
        Label <span className="hint">Shown to the signer as a hint.</span>
        <input className="input-sm" value={f.label ?? ""} maxLength={80} placeholder={FIELD_LABEL[f.type]} onChange={(e) => onChange({ label: e.target.value || null })} />
      </label>

      {textual && (
        <>
          <label className="f">
            Placeholder
            <input className="input-sm" value={f.placeholder ?? ""} maxLength={120} onChange={(e) => onChange({ placeholder: e.target.value || null })} />
          </label>
          <label className="f">
            Default value <span className="hint">{f.type === "name" ? "Leave blank to use the signer's name." : f.type === "email" ? "Leave blank to use the signer's email." : "Pre-filled; the signer can change it."}</span>
            <input className="input-sm" value={f.defaultValue ?? ""} maxLength={500} onChange={(e) => onChange({ defaultValue: e.target.value || null })} />
          </label>
        </>
      )}
      {f.type === "text" && (
        <label className="f">
          Max length
          <input className="input-sm" type="number" min={1} max={2000} value={f.options.maxLength ?? ""} placeholder="500" onChange={(e) => onChange({ options: { ...f.options, maxLength: e.target.value ? Number(e.target.value) : undefined } })} />
        </label>
      )}
      {f.type === "date" && (
        <label className="f">
          Date format
          <select value={f.options.dateFormat ?? ""} onChange={(e) => onChange({ options: { ...f.options, dateFormat: e.target.value || undefined } })}>
            <option value="">Workspace default ({formatDate(new Date(), defaultDateFormat)})</option>
            {DATE_FORMATS.map((d) => (
              <option key={d} value={d}>
                {formatDate(new Date(), d)}
              </option>
            ))}
          </select>
        </label>
      )}
      {(textual || f.type === "date") && (
        <label className="f">
          Font size <span className="hint">Auto fits the box when empty.</span>
          <input className="input-sm" type="number" min={6} max={36} value={f.options.fontSize ?? ""} placeholder="Auto" onChange={(e) => onChange({ options: { ...f.options, fontSize: e.target.value ? Number(e.target.value) : undefined } })} />
        </label>
      )}

      <div>
        <div className="xs muted" style={{ marginBottom: 6 }}>Position · page {f.page + 1} (points)</div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {(
            [
              ["X", "x", info.w],
              ["Y", "y", info.h],
              ["W", "w", info.w],
              ["H", "h", info.h],
            ] as const
          ).map(([l, k, dim]) => (
            <label key={k} className="f" style={{ gap: 3 }}>
              <span className="xs muted">{l}</span>
              <input
                className="input-sm mono"
                type="number"
                value={pt(f[k], dim)}
                onChange={(e) => {
                  const v = Number(e.target.value) / dim;
                  if (!Number.isFinite(v)) return;
                  onChange(normalizeRect({ x: f.x, y: f.y, w: f.w, h: f.h, [k]: v }, info));
                }}
                style={{ padding: "0 6px" }}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={onDuplicate}>
          <Copy size={13} /> Duplicate
        </button>
        <button className="btn danger sm" onClick={onDelete}>
          <Trash2 size={13} /> Delete
        </button>
      </div>
      <p className="xs muted" style={{ lineHeight: 1.6 }}>
        <span className="kbd">←↑→↓</span> nudge · <span className="kbd">⇧</span> ×10 · <span className="kbd">Del</span> remove · <span className="kbd">⌘D</span> duplicate
      </p>
    </div>
  );
}

function DocSettings({ mode, meta, setMeta, fieldCount, pageCount }: { mode: Mode; meta: EMeta; setMeta: React.Dispatch<React.SetStateAction<EMeta>>; fieldCount: number; pageCount: number }) {
  return (
    <>
      <div className="ed-sec">
        <h3>{mode === "template" ? "Template" : "Document"}</h3>
        <dl className="kv" style={{ gridTemplateColumns: "90px 1fr", fontSize: 12.5 }}>
          <dt>Pages</dt>
          <dd>{pageCount}</dd>
          <dt>Fields</dt>
          <dd>{fieldCount}</dd>
        </dl>
        <p className="xs muted" style={{ marginTop: 10, lineHeight: 1.55 }}>Select a field to edit its properties. The signed PDF keeps exactly these {pageCount} pages. No pages are added.</p>
      </div>
      <div className="ed-sec stack" style={{ gap: 12 }}>
        <h3 style={{ marginBottom: 0 }}>Message</h3>
        {mode === "template" && (
          <label className="f">
            Description
            <input className="input-sm" value={meta.description ?? ""} maxLength={500} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} placeholder="What this template is for" />
          </label>
        )}
        <label className="f">
          Note to recipients <span className="hint">Included in the invitation email.</span>
          <textarea value={meta.message} maxLength={2000} onChange={(e) => setMeta((m) => ({ ...m, message: e.target.value }))} placeholder="Hi, please review and sign. Thanks!" />
        </label>
      </div>
      {mode === "document" && (
        <div className="ed-sec stack" style={{ gap: 12 }}>
          <h3 style={{ marginBottom: 0 }}>Deadline &amp; reminders</h3>
          <label className="f">
            Expires
            <select value={meta.expiresInDays} onChange={(e) => setMeta((m) => ({ ...m, expiresInDays: Number(e.target.value) }))}>
              {[3, 7, 14, 30, 60, 90, 120].map((d) => (
                <option key={d} value={d}>
                  {d} days after sending
                </option>
              ))}
              <option value={0}>Never</option>
            </select>
          </label>
          <label className="f">
            Automatic reminders
            <select value={meta.reminderEveryDays} onChange={(e) => setMeta((m) => ({ ...m, reminderEveryDays: Number(e.target.value) }))}>
              <option value={0}>Off</option>
              {[1, 2, 3, 5, 7].map((d) => (
                <option key={d} value={d}>
                  Every {d} day{d > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </label>
          {meta.reminderEveryDays > 0 && (
            <label className="f">
              Up to
              <select value={meta.maxReminders} onChange={(e) => setMeta((m) => ({ ...m, maxReminders: Number(e.target.value) }))}>
                {[1, 2, 3, 5, 10].map((d) => (
                  <option key={d} value={d}>
                    {d} reminder{d > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </>
  );
}

function SendDialog({ open, onClose, docId, meta, setMeta, recipients, fields, problems, flush, onSent }: { open: boolean; onClose: () => void; docId: string; meta: EMeta; setMeta: React.Dispatch<React.SetStateAction<EMeta>>; recipients: ERecipient[]; fields: EField[]; problems: { message: string }[]; flush: () => Promise<boolean>; onSent: (r: { signNow: string | null }) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = meta.signingOrder === "sequential" && recipients.length > 1;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Review and send"
      subtitle={`${meta.title} · ${fields.length} field${fields.length === 1 ? "" : "s"}`}
      wide
      footer={
        <>
          <span className="xs muted" style={{ marginRight: "auto" }}>
            Invitations contain a secure link, not the document.
          </span>
          <button className="btn" onClick={onClose}>
            Back to editing
          </button>
          <button
            className="btn primary"
            disabled={busy || problems.length > 0}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                if (!(await flush())) throw new Error("Couldn't save the latest changes. Check your connection and try again.");
                const r = await api<{ signNow: string | null }>(`/api/admin/documents/${docId}/send`, { json: {} });
                onSent(r);
              } catch (e) {
                setErr(e instanceof ApiError && e.problems?.length ? e.problems.map((p) => p.message).join(" ") : (e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : <Send size={15} />} Send now
          </button>
        </>
      }
    >
      <div className="stack">
        {problems.length > 0 && (
          <div className="note bad">
            <strong>Fix these before sending</strong>
            {problems.map((p, i) => (
              <div key={i}>• {p.message}</div>
            ))}
          </div>
        )}
        <div>
          <div className="small strong" style={{ marginBottom: 8 }}>
            {seq ? "Signing order" : "Recipients (all at once)"}
          </div>
          <div className="stack tight">
            {recipients.map((r, i) => {
              const mine = fields.filter((f) => f.recipientId === r.id);
              return (
                <div key={r.id} className="row nowrap" style={{ gap: 10, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8 }}>
                  {seq && <span className="tag">{i + 1}</span>}
                  <Avatar name={r.name || "?"} email={r.email} color={r.color} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small strong">
                      {r.name || <span className="muted">No name</span>} {r.roleLabel && <span className="muted" style={{ fontWeight: 400 }}>· {r.roleLabel}</span>}
                    </div>
                    <div className="xs muted">{r.email || "No email"}</div>
                  </div>
                  <span className="xs muted">
                    {mine.length} field{mine.length === 1 ? "" : "s"}
                  </span>
                </div>
              );
            })}
          </div>
          {seq && <p className="xs muted" style={{ marginTop: 8 }}>Each person is emailed when the previous one has signed.</p>}
        </div>
        <label className="f">
          Message
          <textarea value={meta.message} maxLength={2000} onChange={(e) => setMeta((m) => ({ ...m, message: e.target.value }))} placeholder="Optional note included in the email" />
        </label>
        <div className="grid g2">
          <label className="f">
            Expires
            <select value={meta.expiresInDays} onChange={(e) => setMeta((m) => ({ ...m, expiresInDays: Number(e.target.value) }))}>
              {[3, 7, 14, 30, 60, 90, 120].map((d) => (
                <option key={d} value={d}>
                  In {d} days
                </option>
              ))}
              <option value={0}>Never</option>
            </select>
          </label>
          <label className="f">
            Reminders
            <select value={meta.reminderEveryDays} onChange={(e) => setMeta((m) => ({ ...m, reminderEveryDays: Number(e.target.value) }))}>
              <option value={0}>Off</option>
              {[1, 2, 3, 5, 7].map((d) => (
                <option key={d} value={d}>
                  Every {d} day{d > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}

function SaveTemplateDialog({ open, onClose, docId, defaultName, flush }: { open: boolean; onClose: () => void; docId: string; defaultName: string; flush: () => Promise<boolean> }) {
  const [name, setName] = useState(defaultName);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => setName(defaultName), [defaultName, open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save as template"
      subtitle="Reuse this PDF, its recipient roles and every field placement."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await flush();
                await api(`/api/admin/documents/${docId}/save-template`, { json: { name, keepPeople: keep } });
                toast("Template saved. Find it under Templates.");
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />} Save template
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="f">
          Template name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </label>
        <label className="check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>
            Keep names and emails as defaults
            <small>Otherwise only the roles (e.g. Sender, Client) are saved.</small>
          </span>
        </label>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}
