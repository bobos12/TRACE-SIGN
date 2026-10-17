import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { fieldPlacement, formatDate, formatPacific, parseOptions, type FieldType, type PageInfo } from "./geometry";

const VERMILION = rgb(1, 0x5a / 255, 0x33 / 255);
const INK = rgb(0.1, 0.1, 0.09);
const MUTED = rgb(0.42, 0.42, 0.39);
const FIELD_INK = rgb(0.06, 0.09, 0.2);

export const MAX_PDF_BYTES = Number(process.env.NEXT_PUBLIC_MAX_PDF_MB || 25) * 1024 * 1024;
export const MAX_PDF_PAGES = 500;

function fmt(d: Date | null | undefined) {
  return d ? formatPacific(d) : "—";
}

// Standard PDF fonts are WinAnsi only; replace anything they can't encode.
export function safe(s: string): string {
  return s.normalize("NFKC").replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = safe(text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface PdfInspection {
  pageCount: number;
  pages: PageInfo[];
}

/**
 * Validates an upload and returns its displayed page geometry.
 * Rejects non-PDFs, encrypted/password-protected files, empty or oversized documents.
 */
export async function inspectPdf(buf: Buffer): Promise<PdfInspection> {
  if (buf.length > MAX_PDF_BYTES) throw new Error(`PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
  const head = buf.subarray(0, 1024).toString("latin1");
  if (!head.includes("%PDF-")) throw new Error("The uploaded file is not a PDF.");
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(buf, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    const msg = (e as Error).message || "";
    if (/encrypt/i.test(msg)) throw new Error("This PDF is password-protected or encrypted. Remove the protection and upload it again.");
    throw new Error("The PDF could not be read. It may be damaged.");
  }
  if (pdf.isEncrypted) throw new Error("This PDF is password-protected or encrypted. Remove the protection and upload it again.");
  const pages = pdf.getPages();
  if (!pages.length) throw new Error("The PDF has no pages.");
  if (pages.length > MAX_PDF_PAGES) throw new Error(`The PDF has ${pages.length} pages; the limit is ${MAX_PDF_PAGES}.`);
  return { pageCount: pages.length, pages: pages.map(displayedInfo) };
}

export async function isPdf(buf: Buffer): Promise<boolean> {
  try {
    await inspectPdf(buf);
    return true;
  } catch {
    return false;
  }
}

function cropBox(page: PDFPage): [number, number, number, number] {
  const c = page.getCropBox();
  const m = page.getMediaBox();
  // pdf.js displays the intersection of CropBox and MediaBox.
  const x0 = Math.max(c.x, m.x);
  const y0 = Math.max(c.y, m.y);
  const x1 = Math.min(c.x + c.width, m.x + m.width);
  const y1 = Math.min(c.y + c.height, m.y + m.height);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : [m.x, m.y, m.x + m.width, m.y + m.height];
}

function rotationOf(page: PDFPage): number {
  return (((page.getRotation().angle ?? 0) % 360) + 360) % 360;
}

function displayedInfo(page: PDFPage): PageInfo {
  const [x0, y0, x1, y1] = cropBox(page);
  const rot = rotationOf(page);
  const w = x1 - x0;
  const h = y1 - y0;
  return rot === 90 || rot === 270 ? { w: h, h: w, rotation: rot } : { w, h, rotation: rot };
}

export interface RenderField {
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
  image: Buffer | null; // PNG
  options?: string | null;
  filledAt?: Date | null;
}

export interface RenderContext {
  timeZone: string;
  dateFormat: string;
}

/** Text value as it will appear on the page (dates are formatted from the stored UTC instant). */
export function displayValue(f: Pick<RenderField, "type" | "value" | "options">, ctx: RenderContext): string {
  if (!f.value) return "";
  if (f.type === "date") {
    const o = parseOptions(f.options);
    const d = new Date(f.value);
    return Number.isNaN(d.getTime()) ? f.value : formatDate(d, o.dateFormat || ctx.dateFormat, ctx.timeZone);
  }
  return f.value;
}

/**
 * Writes completed field values into the ORIGINAL pages at their exact positions.
 * Never adds, removes or reorders pages.
 */
export async function renderFieldsIntoPdf(original: Buffer, fields: RenderField[], ctx: RenderContext): Promise<Buffer> {
  const pdf = await PDFDocument.load(original, { updateMetadata: false });
  const pages = pdf.getPages();
  const before = pages.length;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const imageCache = new Map<Buffer, PDFImage>();

  for (const f of fields) {
    const page = pages[f.page];
    if (!page) throw new Error(`Field refers to page ${f.page + 1}, but the document has ${before} pages.`);
    const box = cropBox(page);
    const rot = rotationOf(page);
    const p = fieldPlacement(f, box, rot);
    const theta = (rot * Math.PI) / 180;
    // Moves (dx, dy) in the field's upright frame into page space.
    const at = (dx: number, dy: number) => ({ x: p.x + dx * Math.cos(theta) - dy * Math.sin(theta), y: p.y + dx * Math.sin(theta) + dy * Math.cos(theta) });

    if ((f.type === "signature" || f.type === "initials") && f.image) {
      let img = imageCache.get(f.image);
      if (!img) {
        img = await pdf.embedPng(f.image);
        imageCache.set(f.image, img);
      }
      const pad = Math.min(p.width, p.height) * 0.04;
      const availW = p.width - pad * 2;
      const availH = p.height - pad * 2;
      const s = Math.min(availW / img.width, availH / img.height);
      const w = img.width * s;
      const h = img.height * s;
      const o = at(pad + (availW - w) / 2, pad + (availH - h) / 2);
      page.drawImage(img, { x: o.x, y: o.y, width: w, height: h, rotate: degrees(rot) });
      continue;
    }

    if (f.type === "checkbox") {
      const size = Math.min(p.width, p.height);
      const o = at((p.width - size) / 2, (p.height - size) / 2);
      page.drawRectangle({ x: o.x, y: o.y, width: size, height: size, borderColor: FIELD_INK, borderWidth: Math.max(0.6, size * 0.06), rotate: degrees(rot) });
      if (f.value === "true") {
        const pt = (fx: number, fy: number) => at((p.width - size) / 2 + fx * size, (p.height - size) / 2 + fy * size);
        const lw = Math.max(1, size * 0.12);
        page.drawLine({ start: pt(0.2, 0.52), end: pt(0.42, 0.28), thickness: lw, color: FIELD_INK });
        page.drawLine({ start: pt(0.42, 0.28), end: pt(0.8, 0.76), thickness: lw, color: FIELD_INK });
      }
      continue;
    }

    const text = safe(displayValue(f, ctx));
    if (!text) continue;
    const o = parseOptions(f.options);
    let size = o.fontSize && o.fontSize > 3 ? o.fontSize : Math.min(14, p.height * 0.62);
    const maxW = p.width - 4;
    while (size > 5 && font.widthOfTextAtSize(text, size) > maxW) size -= 0.5;
    const textH = font.heightAtSize(size, { descender: false });
    const pos = at(2, Math.max(1, (p.height - textH) / 2));
    page.drawText(text, { x: pos.x, y: pos.y, size, font, color: FIELD_INK, rotate: degrees(rot) });
  }

  if (pdf.getPageCount() !== before) throw new Error("Page count changed during rendering.");
  pdf.setProducer("TRACE.SIGN");
  pdf.setModificationDate(new Date());
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

export interface AuditSigner {
  name: string;
  email: string;
  role: string | null;
  order: number;
  status: string;
  invitedAt: Date | null;
  openedAt: Date | null;
  consentAt: Date | null;
  signedAt: Date | null;
  declinedAt: Date | null;
  ip: string | null;
  agent: string | null;
  method: string | null;
  signatureImage: Buffer | null;
  fieldsCompleted: number;
}

export interface AuditInput {
  brandName: string;
  documentTitle: string;
  documentId: string;
  fileName: string;
  pageCount: number;
  originalSha256: string;
  completedSha256: string | null;
  sentAt: Date | null;
  completedAt: Date | null;
  status: string;
  signingOrder: string;
  sealed: boolean;
  timeZone: string;
  signers: AuditSigner[];
  events: { seq: number | null; at: Date; type: string; actor: string | null; detail: string | null; ip: string | null }[];
  chain: { ok: boolean; sealedEvents: number; head?: string | null };
}

/** Separate audit-trail / certificate-of-completion PDF. Never merged into the signed document. */
export async function buildAuditTrailPdf(a: AuditInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const A4: [number, number] = [595.28, 841.89];
  const M = 50;
  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;
  const pageNo = () => pdf.getPageCount();
  const footer = () =>
    page.drawText(safe(`${a.brandName} audit trail  ·  ${a.documentId}  ·  page ${pageNo()}`), { x: M, y: 26, size: 7.5, font: reg, color: MUTED });
  footer();
  const ensure = (need: number) => {
    if (y - need < M) {
      page = pdf.addPage(A4);
      y = A4[1] - M;
      footer();
    }
  };
  const kv = (k: string, v: string, f: PDFFont = reg, kw = 130) => {
    const lines = wrap(v, f, 9, A4[0] - M * 2 - kw);
    ensure(12 * lines.length + 4);
    page.drawText(k, { x: M, y, size: 9, font: bold, color: MUTED });
    lines.forEach((l, i) => page.drawText(l, { x: M + kw, y: y - i * 12, size: 9, font: f, color: INK }));
    y -= 12 * lines.length + 5;
  };

  // Header mark
  const S = 7.5;
  const half = S / Math.SQRT2;
  const diamond = (cx: number, cy: number, color = INK) => page.drawSquare({ x: cx, y: cy - half, size: S, rotate: degrees(45), color });
  diamond(M + 10, y - 5 + half + 1, VERMILION);
  diamond(M + 10 - half - 1, y - 5, INK);
  diamond(M + 10 + half + 1, y - 5, INK);
  page.drawText(safe(a.brandName), { x: M + 28, y: y - 10, size: 13, font: bold, color: INK });
  y -= 40;
  page.drawText("Audit Trail & Certificate of Completion", { x: M, y, size: 18, font: bold, color: INK });
  y -= 18;
  page.drawText("This record is issued separately from the signed document and is not part of it.", { x: M, y, size: 8.5, font: reg, color: MUTED });
  y -= 24;

  kv("Document", a.documentTitle);
  kv("Document ID", a.documentId, mono);
  kv("Original file", `${a.fileName} (${a.pageCount} page${a.pageCount === 1 ? "" : "s"})`);
  kv("Status", a.status);
  kv("Signing order", a.signingOrder === "sequential" ? "Sequential (one after another)" : "Parallel (all at once)");
  kv("Sent", fmt(a.sentAt));
  kv("Completed", fmt(a.completedAt));
  kv("Original SHA-256", a.originalSha256, mono);
  if (a.completedSha256) kv("Signed PDF SHA-256", a.completedSha256, mono);
  kv("Digital seal", a.sealed ? "Signed PDF carries a PKCS#7 digital seal; any later change to it is detectable in PDF readers." : "Not applied");
  kv("Audit chain", a.chain.ok ? `Verified: ${a.chain.sealedEvents} events, HMAC-SHA256 chained` : "VERIFICATION FAILED");
  if (a.chain.head) kv("Chain head", a.chain.head, mono);

  y -= 8;
  ensure(40);
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: MUTED });
  y -= 22;
  page.drawText("Signers", { x: M, y, size: 12, font: bold, color: INK });
  y -= 20;

  for (const s of a.signers) {
    ensure(170);
    page.drawText(safe(`${s.order}. ${s.name}  <${s.email}>${s.role ? `  ·  ${s.role}` : ""}`), { x: M, y, size: 10, font: bold, color: INK });
    y -= 8;
    if (s.signatureImage) {
      try {
        const img = await pdf.embedPng(s.signatureImage);
        const h = 34;
        const w = Math.min(200, (img.width / img.height) * h);
        page.drawImage(img, { x: M + 4, y: y - h - 2, width: w, height: h });
      } catch {
        /* image unreadable: facts below still apply */
      }
    }
    y -= 40;
    page.drawLine({ start: { x: M, y }, end: { x: M + 230, y }, thickness: 0.6, color: VERMILION });
    y -= 14;
    const facts: [string, string][] = [
      ["Status", s.status],
      ["Invited", fmt(s.invitedAt)],
      ["Viewed", fmt(s.openedAt)],
      ["E-sign consent", fmt(s.consentAt)],
      [s.declinedAt ? "Declined" : "Signed", fmt(s.signedAt ?? s.declinedAt)],
      ["Signature method", s.method ?? "—"],
      ["Fields completed", String(s.fieldsCompleted)],
      ["IP address", s.ip ?? "—"],
      ["User agent", (s.agent ?? "—").slice(0, 160)],
    ];
    for (const [k, v] of facts) {
      const lines = wrap(v, reg, 8, A4[0] - M * 2 - 100);
      ensure(10 * lines.length + 3);
      page.drawText(k, { x: M, y, size: 8, font: bold, color: MUTED });
      lines.forEach((l, i) => page.drawText(l, { x: M + 100, y: y - i * 10, size: 8, font: reg, color: INK }));
      y -= 10 * lines.length + 2;
    }
    y -= 14;
  }

  ensure(40);
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: MUTED });
  y -= 22;
  page.drawText("Event history (Pacific Time)", { x: M, y, size: 12, font: bold, color: INK });
  y -= 18;
  for (const e of a.events) {
    const text = `${e.type.replace(/_/g, " ")}${e.actor ? ` · ${e.actor}` : ""}${e.detail ? ` · ${e.detail}` : ""}${e.ip ? ` · IP ${e.ip}` : ""}`;
    const lines = wrap(text, reg, 8, A4[0] - M * 2 - 140);
    ensure(10 * lines.length + 4);
    page.drawText(`${e.seq ?? "-"}  ${fmt(e.at)}`, { x: M, y, size: 8, font: mono, color: MUTED });
    lines.forEach((l, i) => page.drawText(l, { x: M + 140, y: y - i * 10, size: 8, font: reg, color: INK }));
    y -= 10 * lines.length + 3;
  }

  y -= 14;
  const note =
    "Each signer reached the document through a personal, expiring link sent to the email address shown, agreed to do business electronically, " +
    "and adopted the signature shown. Times are recorded by the server and shown in Pacific Time (America/Los_Angeles). The SHA-256 values identify the exact files: recompute them to " +
    "confirm a copy is unaltered, or upload a copy on the verification page.";
  for (const l of wrap(note, reg, 8, A4[0] - M * 2)) {
    ensure(12);
    page.drawText(l, { x: M, y, size: 8, font: reg, color: MUTED });
    y -= 10;
  }

  pdf.setTitle(`${safe(a.documentTitle)} — audit trail`);
  pdf.setProducer("TRACE.SIGN");
  pdf.setCreator("TRACE.SIGN");
  return Buffer.from(await pdf.save());
}
