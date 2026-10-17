"use client";
// Lazily loads pdf.js (legacy build: includes polyfills for older mobile browsers).
// Worker, fonts and CMaps are served from this app (public/pdfjs), never a CDN.
import type * as PdfJs from "pdfjs-dist";

type Lib = typeof PdfJs;
let lib: Promise<Lib> | null = null;

export function loadPdfjs(): Promise<Lib> {
  lib ??= import("pdfjs-dist/legacy/build/pdf.min.mjs" as string).then((m: Lib) => {
    m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return m;
  });
  return lib;
}

export type PdfDoc = PdfJs.PDFDocumentProxy;

export async function openPdf(url: string): Promise<PdfDoc> {
  const pdfjs = await loadPdfjs();
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `Could not load the document (${res.status}).`);
  }
  const data = new Uint8Array(await res.arrayBuffer());
  return pdfjs.getDocument({
    data,
    isEvalSupported: false, // never evaluate code from the PDF
    enableXfa: false,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
  }).promise;
}
