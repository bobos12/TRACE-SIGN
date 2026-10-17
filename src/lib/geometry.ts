// Shared by the browser editor, the signing page and the server-side PDF writer.
//
// A field's position is stored as fractions (0..1) of the page *as displayed*
// (after the page's /Rotate is applied), with the origin at the top-left corner.
// Because it's relative, it doesn't depend on screen size, zoom level or device
// pixel ratio, and it maps exactly back onto PDF user space at finalization.

export type FieldType = "signature" | "initials" | "name" | "date" | "text" | "email" | "checkbox";

export const FIELD_TYPES: FieldType[] = ["signature", "initials", "name", "date", "text", "email", "checkbox"];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Page geometry as displayed (rotation applied). Units: PDF points. */
export interface PageInfo {
  w: number;
  h: number;
  rotation: number; // 0 | 90 | 180 | 270
}

/** Default size of a newly dropped field, in PDF points (as displayed). */
export const DEFAULT_SIZE: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 180, h: 48 },
  initials: { w: 72, h: 40 },
  name: { w: 170, h: 24 },
  date: { w: 110, h: 24 },
  text: { w: 170, h: 24 },
  email: { w: 190, h: 24 },
  checkbox: { w: 18, h: 18 },
};

export const MIN_SIZE_PT = 10;

export const FIELD_LABEL: Record<FieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  name: "Full name",
  date: "Date signed",
  text: "Text",
  email: "Email",
  checkbox: "Checkbox",
};

export const DATE_FORMATS = ["MMM d, yyyy", "MM/dd/yyyy", "dd/MM/yyyy", "yyyy-MM-dd", "d MMMM yyyy"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

/** Keeps a rect inside the page and at least MIN_SIZE_PT in each direction. */
export function normalizeRect(r: Rect, page: PageInfo): Rect {
  const minW = Math.min(1, MIN_SIZE_PT / page.w);
  const minH = Math.min(1, MIN_SIZE_PT / page.h);
  const w = Math.min(1, Math.max(minW, r.w));
  const h = Math.min(1, Math.max(minH, r.h));
  const x = Math.min(1 - w, Math.max(0, r.x));
  const y = Math.min(1 - h, Math.max(0, r.y));
  return { x, y, w, h };
}

/**
 * Converts a point given as fractions of the displayed page into PDF user space.
 * `box` is the page's CropBox [x0, y0, x1, y1] in unrotated user space.
 * Verified against pdf.js's viewport transform for 0/90/180/270.
 */
export function displayToPdf(u: number, v: number, box: [number, number, number, number], rotation: number): { x: number; y: number } {
  const [x0, y0, x1, y1] = box;
  const W = x1 - x0;
  const H = y1 - y0;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: x0 + v * W, y: y0 + u * H };
    case 180:
      return { x: x1 - u * W, y: y0 + v * H };
    case 270:
      return { x: x1 - v * W, y: y1 - u * H };
    default:
      return { x: x0 + u * W, y: y1 - v * H };
  }
}

/**
 * Placement for drawing a field's content so it appears upright to the reader.
 * Returns the anchor (the field's bottom-left corner as displayed) in PDF space,
 * the size in points as displayed, and the counter-clockwise rotation to draw with.
 */
export function fieldPlacement(r: Rect, box: [number, number, number, number], rotation: number) {
  const rot = ((rotation % 360) + 360) % 360;
  const W = box[2] - box[0];
  const H = box[3] - box[1];
  const dispW = rot === 90 || rot === 270 ? H : W;
  const dispH = rot === 90 || rot === 270 ? W : H;
  const anchor = displayToPdf(r.x, r.y + r.h, box, rot);
  return { x: anchor.x, y: anchor.y, width: r.w * dispW, height: r.h * dispH, rotate: rot };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Formats an instant as a calendar date in the given IANA time zone. */
/** Every date and time TRACE.SIGN shows is Pacific Time (California): PST in winter, PDT in summer. Instants are stored in UTC. */
export const APP_TIME_ZONE = "America/Los_Angeles";

/** "Oct 16, 2026, 9:52 PM PDT" (or date only). */
export function formatPacific(at: Date | string | number, opts: { time?: boolean } = { time: true }): string {
  const d = new Date(at);
  const date: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", timeZone: APP_TIME_ZONE };
  return new Intl.DateTimeFormat("en-US", opts.time === false ? date : { ...date, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
}

export function formatDate(at: Date | string, format: string = "MMM d, yyyy", timeZone = APP_TIME_ZONE): string {
  const d = typeof at === "string" ? new Date(at) : at;
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    );
  } catch {
    parts = { year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1), day: String(d.getUTCDate()) };
  }
  const y = parts.year;
  const m = Number(parts.month);
  const dd = Number(parts.day);
  const p2 = (n: number) => String(n).padStart(2, "0");
  switch (format) {
    case "MM/dd/yyyy":
      return `${p2(m)}/${p2(dd)}/${y}`;
    case "dd/MM/yyyy":
      return `${p2(dd)}/${p2(m)}/${y}`;
    case "yyyy-MM-dd":
      return `${y}-${p2(m)}-${p2(dd)}`;
    case "d MMMM yyyy":
      return `${dd} ${MONTHS[m - 1]} ${y}`;
    default:
      return `${MONTHS[m - 1].slice(0, 3)} ${dd}, ${y}`;
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Distinct, accessible colors assigned to recipients in order. */
export const RECIPIENT_COLORS = ["#3B6FF5", "#E8590C", "#0E9F6E", "#9B4DE0", "#D6336C", "#0B8DA6", "#B7791F", "#5C6AC4"];

export interface FieldOptions {
  dateFormat?: string;
  fontSize?: number;
  maxLength?: number;
}

export function parseOptions(raw: string | null | undefined): FieldOptions {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as FieldOptions;
    return typeof o === "object" && o ? o : {};
  } catch {
    return {};
  }
}
