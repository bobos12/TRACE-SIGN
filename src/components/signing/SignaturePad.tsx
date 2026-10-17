"use client";
import "@fontsource/great-vibes/400.css";
import "@fontsource/dancing-script/400.css";
import "@fontsource/caveat/400.css";
import "@fontsource/homemade-apple/400.css";
import { useEffect, useRef, useState } from "react";
import { Eraser, ImageUp, PenLine, Type } from "lucide-react";
import { Modal } from "@/components/ui";

export type SigMethod = "typed" | "drawn" | "uploaded";
export interface Adopted {
  method: SigMethod;
  png: string; // data URL
  text?: string;
}

export const SIG_FONTS = [
  { family: "Great Vibes", size: 1 },
  { family: "Dancing Script", size: 0.9 },
  { family: "Homemade Apple", size: 0.72 },
  { family: "Caveat", size: 1.05 },
];
const INK = "#13213f";

/** Crops a canvas to its ink (non-transparent pixels) plus padding. */
function trimmed(src: HTMLCanvasElement, pad = 12): HTMLCanvasElement | null {
  const ctx = src.getContext("2d")!;
  const { width: w, height: h } = src;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1 + pad * 2;
  out.height = y1 - y0 + 1 + pad * 2;
  out.getContext("2d")!.drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return out;
}

async function typedPng(text: string, family: string, scale: number): Promise<string> {
  const px = Math.round(110 * scale);
  try {
    await document.fonts.load(`${px}px "${family}"`, text);
  } catch {
    /* fall back to whatever is available */
  }
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = `${px}px "${family}"`;
  const w = Math.ceil(ctx.measureText(text).width) + px;
  c.width = Math.min(2400, w);
  c.height = Math.round(px * 1.9);
  ctx.font = `${px}px "${family}"`;
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.fillText(text, px * 0.4, c.height / 2);
  return (trimmed(c) ?? c).toDataURL("image/png");
}

/** Freehand pad with smoothed strokes and velocity-based width. Mouse, touch and stylus. */
function DrawPad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [empty, setEmpty] = useState(true);
  const pts = useRef<{ x: number; y: number; t: number }[]>([]);
  const lastW = useRef(3);

  useEffect(() => {
    const c = ref.current!;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const snapshot = !empty ? c.toDataURL() : null;
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      const ctx = c.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      if (snapshot) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height);
        img.src = snapshot;
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
  };
  const emit = () => {
    const c = ref.current!;
    const t = trimmed(c, 16);
    onChange(t ? t.toDataURL("image/png") : null);
  };

  return (
    <div className="sig-pad">
      <canvas
        ref={ref}
        aria-label="Draw your signature"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          const p = pos(e);
          pts.current = [p];
          lastW.current = 2.6;
          const ctx = ref.current!.getContext("2d")!;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
          ctx.fill();
          if (empty) setEmpty(false);
        }}
        onPointerMove={(e) => {
          if (!pts.current.length || !(e.buttons & 1 || e.pointerType === "touch" || e.pointerType === "pen")) return;
          const ctx = ref.current!.getContext("2d")!;
          const p = pos(e);
          const list = pts.current;
          const prev = list[list.length - 1];
          const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
          if (dist < 1.2) return;
          const v = dist / Math.max(1, p.t - prev.t);
          const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
          const target = Math.max(1.2, Math.min(4.2, 3.6 - v * 1.1)) * (0.7 + pressure * 0.6);
          const w = lastW.current * 0.65 + target * 0.35;
          lastW.current = w;
          ctx.lineWidth = w;
          const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
          const before = list.length > 1 ? list[list.length - 2] : prev;
          const start = { x: (before.x + prev.x) / 2, y: (before.y + prev.y) / 2 };
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
          ctx.stroke();
          list.push(p);
        }}
        onPointerUp={() => {
          pts.current = [];
          emit();
        }}
        onPointerCancel={() => (pts.current = [])}
      />
      <span className="line" />
      <span className="x">×</span>
      {empty && <span className="hint-c">Draw with your mouse, finger or stylus</span>}
      {!empty && (
        <button
          type="button"
          className="btn sm clear"
          onClick={() => {
            const c = ref.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setEmpty(true);
            onChange(null);
          }}
        >
          <Eraser size={13} /> Clear
        </button>
      )}
    </div>
  );
}

/** Loads an uploaded image, removes a white/light background and trims it. */
async function processUpload(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error("Upload a PNG or JPG image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image must be under 5 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error("That image couldn't be read."));
      i.src = url;
    });
    const s = Math.min(1, 1200 / img.width, 500 / img.height);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const lum = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
      if (lum > 215) d.data[i + 3] = 0;
      else if (lum > 170) d.data[i + 3] = Math.round(d.data[i + 3] * ((215 - lum) / 45));
    }
    ctx.putImageData(d, 0, 0);
    const t = trimmed(c, 8);
    if (!t) throw new Error("No signature found in that image.");
    return t.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AdoptDialog({ open, kind, name, onClose, onAdopt }: { open: boolean; kind: "signature" | "initials"; name: string; onClose: () => void; onAdopt: (a: Adopted) => void }) {
  const [tab, setTab] = useState<SigMethod>("typed");
  const initialsOf = (n: string) =>
    n
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0]!.toUpperCase())
      .join("")
      .slice(0, 4);
  const [text, setText] = useState(kind === "initials" ? initialsOf(name) : name);
  const [font, setFont] = useState(0);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setText(kind === "initials" ? initialsOf(name) : name);
      setErr(null);
    }
  }, [open, kind, name]);

  const ready = tab === "typed" ? text.trim().length >= (kind === "initials" ? 1 : 2) : tab === "drawn" ? !!drawn : !!uploaded;
  const label = kind === "signature" ? "signature" : "initials";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adopt your ${label}`}
      subtitle={`This ${label} will be placed in every ${label} field assigned to you.`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (tab === "typed") onAdopt({ method: "typed", png: await typedPng(text.trim(), SIG_FONTS[font].family, SIG_FONTS[font].size), text: text.trim() });
                else if (tab === "drawn" && drawn) onAdopt({ method: "drawn", png: drawn });
                else if (uploaded) onAdopt({ method: "uploaded", png: uploaded });
              } finally {
                setBusy(false);
              }
            }}
          >
            Adopt and sign
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="seg" role="tablist" style={{ width: "100%" }}>
          {(
            [
              ["typed", Type, "Type"],
              ["drawn", PenLine, "Draw"],
              ["uploaded", ImageUp, "Upload"],
            ] as const
          ).map(([k, I, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} style={{ flex: 1, justifyContent: "center" }} onClick={() => setTab(k)}>
              <I size={14} /> {l}
            </button>
          ))}
        </div>

        {tab === "typed" && (
          <>
            <label className="f">
              {kind === "signature" ? "Full name" : "Initials"}
              <input value={text} maxLength={kind === "signature" ? 80 : 6} onChange={(e) => setText(e.target.value)} autoComplete={kind === "signature" ? "name" : "off"} />
            </label>
            <div className="sig-styles" role="radiogroup" aria-label="Signature style">
              {SIG_FONTS.map((f, i) => (
                <button key={f.family} type="button" role="radio" aria-checked={font === i} className={`sig-style ${font === i ? "on" : ""}`} onClick={() => setFont(i)} style={{ fontFamily: `"${f.family}", cursive`, fontSize: 30 * f.size }}>
                  {text || (kind === "signature" ? "Your name" : "AB")}
                </button>
              ))}
            </div>
          </>
        )}
        {tab === "drawn" && <DrawPad key={String(open)} onChange={setDrawn} />}
        {tab === "uploaded" && (
          <div className="sig-upload">
            {uploaded ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={uploaded} alt="Uploaded signature" />
            ) : (
              <div>
                <ImageUp size={22} />
                <div style={{ marginTop: 6 }}>Upload a photo or scan of your {label}</div>
                <div className="xs">PNG or JPG · white backgrounds are removed automatically</div>
              </div>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={`Upload ${label} image`}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setErr(null);
                try {
                  setUploaded(await processUpload(f));
                } catch (x) {
                  setErr((x as Error).message);
                }
              }}
            />
          </div>
        )}
        {err && <div className="note bad">{err}</div>}
        <p className="xs muted" style={{ lineHeight: 1.6 }}>
          By selecting Adopt and sign, I agree that this {label} is the electronic representation of my {label} for all purposes when I use it on documents, just the same as a pen-and-paper {label}.
        </p>
      </div>
    </Modal>
  );
}
