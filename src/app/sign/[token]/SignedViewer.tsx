"use client";
import { useRef } from "react";
import type { PageInfo } from "@/lib/geometry";
import { PdfPage, useFitScale, usePdf } from "@/components/pdf/PdfPages";

/** Read-only view of the (signed) document below the status message. */
export function SignedViewer({ src, pages, flush }: { src: string; pages: PageInfo[]; flush?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { doc, error } = usePdf(src);
  const scale = useFitScale(ref, pages, { max: 1.2 * (96 / 72), padding: 8 });
  return (
    <div ref={ref} style={{ marginTop: flush ? 0 : 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, background: "var(--canvas)", padding: "20px 0", borderRadius: flush ? 0 : 12, maxHeight: flush ? 900 : undefined, overflowY: flush ? "auto" : undefined }}>
      {error && <div className="note bad">{error}</div>}
      {pages.map((p, i) => (
        <PdfPage key={i} doc={doc} index={i} info={p} scale={scale} />
      ))}
    </div>
  );
}
