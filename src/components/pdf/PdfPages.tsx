"use client";
import { useEffect, useRef, useState } from "react";
import type { PageInfo } from "@/lib/geometry";
import { openPdf, type PdfDoc } from "./pdfjs";

/** Loads a PDF once and exposes it with its loading state. */
export function usePdf(url: string | null) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let loaded: PdfDoc | null = null;
    setDoc(null);
    setError(null);
    openPdf(url)
      .then((d) => {
        loaded = d;
        if (alive) setDoc(d);
        else void d.destroy();
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
      void loaded?.destroy();
    };
  }, [url]);
  return { doc, error };
}

/**
 * One PDF page as a canvas, rendered at the device pixel ratio when it scrolls into view.
 * Children are positioned over the page (the field layer).
 */
export function PdfPage({
  doc,
  index,
  info,
  scale,
  children,
  className = "",
  onPointerDown,
  label,
}: {
  doc: PdfDoc | null;
  index: number;
  info: PageInfo;
  scale: number; // CSS px per PDF point
  children?: React.ReactNode;
  className?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  label?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const w = Math.round(info.w * scale);
  const h = Math.round(info.h * scale);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setVisible(true)), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !visible || !canvas.current) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const page = await doc.getPage(index + 1);
        if (!alive || !canvas.current) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        // Cap the bitmap so huge zoom levels don't exhaust mobile memory.
        const maxSide = 5000;
        const s = Math.min(scale * dpr, maxSide / Math.max(info.w, info.h));
        const vp = page.getViewport({ scale: s });
        const c = canvas.current;
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        const ctx = c.getContext("2d", { alpha: false });
        if (!ctx) return;
        task = page.render({ canvasContext: ctx, viewport: vp, annotationMode: 1 /* ENABLE: show annotations, not forms */ }) as unknown as typeof task;
        await task!.promise;
        if (alive) setRendered(true);
      } catch (e) {
        if ((e as Error)?.name !== "RenderingCancelledException") console.warn("page render failed", e);
      }
    }, rendered ? 120 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, visible, scale, index]);

  return (
    <div ref={wrap} className={`pg ${className}`} style={{ width: w, height: h }} data-page={index} onPointerDown={onPointerDown} aria-label={label ?? `Page ${index + 1}`}>
      <canvas ref={canvas} />
      {!rendered && (
        <div className="pg-ph">
          <div className="spinner" />
        </div>
      )}
      <div className="pg-layer">{children}</div>
    </div>
  );
}

/** Fits the widest page into the available width (with a sensible maximum). */
export function useFitScale(container: React.RefObject<HTMLElement>, pages: PageInfo[], opts: { max?: number; padding?: number } = {}) {
  const [fit, setFit] = useState(1.2);
  useEffect(() => {
    const el = container.current;
    if (!el || !pages.length) return;
    const widest = Math.max(...pages.map((p) => p.w));
    const calc = () => {
      const avail = el.clientWidth - (opts.padding ?? 48);
      setFit(Math.max(0.3, Math.min(opts.max ?? 1.6, avail / widest)));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [container, pages, opts.max, opts.padding]);
  return fit;
}
