/**
 * Workflow test for the v2 signing pipeline — real code, real SMTP server, real PDFs:
 *   PGlite (PostgreSQL in WASM) running the SQL migrations, smtp-server capturing mail,
 *   pdf-lib to build inputs, pdf.js to verify where things landed in the output.
 *
 *   npx tsx scripts/e2e-workflow.ts
 *
 * Covers test scenarios A (two signers, page 5, sequential), B (multiple pages, rotated
 * and cropped pages), D (incomplete / premature finalization) and E (cross-recipient
 * access, tampering, editing after send) at the service layer.
 */
import { readFileSync } from "fs";
import { randomBytes, randomUUID } from "crypto";
import { deflateSync } from "zlib";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { simpleParser } from "mailparser";

process.env.APP_URL = "https://sign.trace-studio.tech";
process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = randomBytes(32).toString("base64");
process.env.ADMIN_EMAIL = "owner@trace-studio.tech";
process.env.ADMIN_PASSWORD_HASH = "scrypt:x:y";

let pass = 0;
let fail = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`  ✘ ${name}`, extra ?? "");
  }
}
async function rejects(name: string, p: Promise<unknown>, re?: RegExp) {
  try {
    await p;
    check(name, false, "did not throw");
  } catch (e) {
    check(name, !re || re.test((e as Error).message), (e as Error).message);
  }
}
const id = () => randomUUID().replace(/-/g, "");

/** Minimal PNG encoder (RGBA) so the test signs with a real image. */
function png(w: number, h: number, paint: (x: number, y: number) => boolean): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const on = paint(x, y);
      raw[o] = 20;
      raw[o + 1] = 30;
      raw[o + 2] = 90;
      raw[o + 3] = on ? 255 : 0;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const sigPng = (seed: number) => "data:image/png;base64," + png(300, 80, (x, y) => Math.abs(y - (40 + 25 * Math.sin((x + seed) / 18))) < 3).toString("base64");

async function makePdf(pages: { size: [number, number]; rotate?: number; crop?: [number, number, number, number] }[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pages.forEach((p, i) => {
    const page = pdf.addPage(p.size);
    page.drawText(`Contract page ${i + 1}`, { x: 60, y: p.size[1] - 80, size: 18, font });
    if (p.rotate) page.setRotation(degrees(p.rotate));
    if (p.crop) page.setCropBox(...p.crop);
  });
  return Buffer.from(await pdf.save());
}

// pdf.js (legacy build runs in Node) for verifying the output.
async function pdfjs() {
  return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist");
}

/** Text items on a page in DISPLAY space as fractions of the page (origin top-left). */
async function textOnPage(buf: Buffer, pageNo: number) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return {
    vp,
    items: tc.items
      .filter((i): i is { str: string; transform: number[] } & typeof i => "str" in i)
      .map((i) => {
        const [x, y] = vp.convertToViewportPoint(i.transform[4], i.transform[5]);
        return { str: i.str, u: x / vp.width, v: y / vp.height };
      }),
  };
}

/** Image placements on a page, as display-space bounding boxes (fractions). */
async function imagesOnPage(buf: Buffer, pageNo: number) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const out: { u0: number; v0: number; u1: number; v1: number }[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const mul = (a: number[], b: number[]) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === lib.OPS.save) stack.push(ctm);
    else if (fn === lib.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === lib.OPS.transform) ctm = mul(ctm, args as number[]);
    else if (fn === lib.OPS.paintImageXObject) {
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => vp.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
      const us = corners.map((c) => c[0] / vp.width);
      const vs = corners.map((c) => c[1] / vp.height);
      out.push({ u0: Math.min(...us), v0: Math.min(...vs), u1: Math.max(...us), v1: Math.max(...vs) });
    }
  }
  return out;
}

async function main() {
  // ── Database (both migrations, exactly as production applies them) ─────
  const pg = new PGlite();
  for (const f of ["drizzle/0000_init.sql", "drizzle/0001_v2_editor.sql", "drizzle/0002_pacific_time.sql"]) {
    for (const stmt of readFileSync(f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
  }
  const schema = await import("../src/lib/schema");
  (globalThis as Record<string, unknown>).__tsDb = drizzle(pg, { schema });
  const { db, t } = await import("../src/lib/db");
  const settings = await import("../src/lib/settings");
  const outbox = await import("../src/lib/mail/outbox");
  const docs = await import("../src/lib/documents");
  const templates = await import("../src/lib/templates");
  const { signingToken, openBlob } = await import("../src/lib/crypto");
  const { verifyAuditChain } = await import("../src/lib/audit");

  // ── SMTP server capturing everything ───────────────────────────────────
  const { SMTPServer } = await import("smtp-server");
  const received: { to: string[]; raw: Buffer }[] = [];
  const smtp = new SMTPServer({
    secure: false,
    authOptional: false,
    disabledCommands: ["STARTTLS"],
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _s, cb) {
      return auth.password === "pw" ? cb(null, { user: auth.username }) : cb(new Error("bad"));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        received.push({ to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks) });
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(25251, "127.0.0.1", r));
  await settings.saveSettings(
    settings.settingsInput.parse({
      smtpHost: "127.0.0.1",
      smtpPort: 25251,
      smtpSecurity: "none",
      smtpUser: "hello@trace-studio.tech",
      smtpPassword: "pw",
      fromEmail: "trace.sign@trace-studio.tech",
      fromName: "TRACE.SIGN",
      replyTo: "",
      imapEnabled: false,
      imapHost: "",
      imapPort: 993,
      imapSecure: true,
      imapUseSmtpLogin: true,
      imapUser: "",
      imapPassword: "",
      imapMailbox: "INBOX",
      imapReadOnly: true,
      imapInitialLookbackDays: 14,
      adminNotifyEmail: "",
      notifyOnOpen: true,
      notifyOnDecline: true,
      notifyOnComplete: true,
      notifyOnExpire: true,
    }),
  );
  const flush = async () => {
    for (let i = 0; i < 5; i++) await outbox.processOutbox({ limit: 100 });
  };
  const mailTo = async (addr: string, subjectRe: RegExp) => {
    for (const m of received.filter((x) => x.to.includes(addr))) {
      const p = await simpleParser(m.raw);
      if (subjectRe.test(p.subject ?? "")) return p;
    }
    return null;
  };
  const linkIn = (html: string) => {
    const m = html.match(/https:\/\/sign\.trace-studio\.tech\/sign\/([\w.-]+)/);
    return m ? m[1] : null;
  };
  const actor = { label: "sender:travis@bail.example", ip: "203.0.113.5", userAgent: "test" };

  // ══ Scenario A — five pages, two signers, everything on page 5 ═════════
  console.log("\nA. Two signers, fields on page 5 of a five-page PDF");
  const five = await makePdf(Array.from({ length: 5 }, () => ({ size: [612, 792] as [number, number] })));
  const draft = await docs.createDraft({ orgId: "default", createdBy: "env", senderEmail: "travis@bail.example", senderName: "Travis Bail Bonds", file: five, fileName: "contract.pdf", title: "Bail Agreement" }, actor);
  check("draft created with 5 pages", draft.status === "draft" && draft.pageCount === 5);
  check("original stored encrypted at rest", draft.fileData.subarray(0, 4).toString() === "TSE1" && !draft.fileData.includes(Buffer.from("%PDF")));

  const travis = id();
  const michael = id();
  const F = {
    tSig: id(),
    tDate: id(),
    mSig: id(),
    mName: id(),
    mDate: id(),
    mText: id(),
  };
  const layout = [
    { id: F.tSig, recipientId: travis, type: "signature", page: 4, x: 0.1, y: 0.7, w: 0.3, h: 0.06 },
    { id: F.tDate, recipientId: travis, type: "date", page: 4, x: 0.1, y: 0.78, w: 0.18, h: 0.03 },
    { id: F.mSig, recipientId: michael, type: "signature", page: 4, x: 0.55, y: 0.7, w: 0.3, h: 0.06 },
    { id: F.mName, recipientId: michael, type: "name", page: 4, x: 0.55, y: 0.78, w: 0.3, h: 0.03 },
    { id: F.mDate, recipientId: michael, type: "date", page: 4, x: 0.55, y: 0.83, w: 0.18, h: 0.03 },
    { id: F.mText, recipientId: michael, type: "text", page: 2, x: 0.2, y: 0.4, w: 0.3, h: 0.03, required: false, placeholder: "Case number" },
  ].map((f) => ({ required: true, label: null, placeholder: null, defaultValue: null, options: {}, ...f }));
  const input = {
    title: "Bail Agreement",
    message: "Please sign",
    signingOrder: "sequential" as const,
    expiresInDays: 14,
    reminderEveryDays: 3,
    maxReminders: 3,
    recipients: [
      { id: travis, name: "Travis", email: "travis@bail.example", roleLabel: "Sender", order: 1 },
      { id: michael, name: "Michael Client", email: "michael@client.example", roleLabel: "Client", order: 2 },
    ],
    fields: layout,
  };
  // validation before send
  await docs.saveDraft(draft.id, "default", docs.draftInput.parse({ ...input, fields: layout.filter((f) => f.recipientId === travis) }));
  await rejects("send blocked when a signer has no signature field", docs.sendDocument(draft.id, "default", actor), /Michael Client has no signature/);
  await rejects("field on non-existent page rejected", docs.saveDraft(draft.id, "default", docs.draftInput.parse({ ...input, fields: [{ ...layout[0], page: 9 }] })), /page 10/);
  await rejects("field for unknown recipient rejected", docs.saveDraft(draft.id, "default", docs.draftInput.parse({ ...input, fields: [{ ...layout[0], recipientId: id() }] })), /recipient/);
  await rejects("other workspace can't read the draft", docs.getDocument(draft.id, "other-org"), /not found/);
  await docs.saveDraft(draft.id, "default", docs.draftInput.parse(input));
  check("layout saved (6 fields)", (await docs.fieldsOf(draft.id)).length === 6);

  await docs.sendDocument(draft.id, "default", actor);
  await flush();
  let recs = await docs.recipientsOf(draft.id);
  check("sequential: Travis invited first", recs.find((r) => r.id === travis)?.status === "sent");
  check("sequential: Michael not invited yet", recs.find((r) => r.id === michael)?.status === "pending");
  check("only Travis got an invitation email", !!(await mailTo("travis@bail.example", /Signature requested/)) && !(await mailTo("michael@client.example", /Signature requested/)));
  await rejects("fields locked after send", docs.saveDraft(draft.id, "default", docs.draftInput.parse(input)), /locked/);

  const tInvite = await mailTo("travis@bail.example", /Signature requested/);
  const tToken = linkIn(String(tInvite?.html ?? ""))!;
  check("invitation contains an expiring signing link (4-part token)", tToken?.split(".").length === 4);
  check("invitation has no PDF attached", !(tInvite?.attachments ?? []).some((a) => a.contentType === "application/pdf"));
  const mEarly = signingToken(michael, 1, Date.now() + 3600_000);
  await rejects("Michael can't sign before his turn", docs.completeSigning(mEarly, { consent: true, values: {}, signature: { method: "drawn", png: sigPng(1) } }, actor), /isn't your turn/);

  // Scenario E — Travis tries to fill Michael's field
  await rejects("Travis can't fill Michael's fields", docs.completeSigning(tToken, { consent: true, values: { [F.mName]: "Hacked" }, signature: { method: "drawn", png: sigPng(1) } }, actor), /assigned to you/);
  await rejects("forged token rejected", docs.completeSigning(tToken.slice(0, -2) + "xx", { consent: true, values: {}, signature: { method: "drawn", png: sigPng(1) } }, actor), /not valid/);
  // Scenario D — missing required signature
  await rejects("required signature can't be skipped", docs.completeSigning(tToken, { consent: true, values: {} }, actor), /signature/);
  await rejects("non-PNG signature rejected", docs.completeSigning(tToken, { consent: true, values: {}, signature: { method: "uploaded", png: "data:image/png;base64," + Buffer.from("GIF89a nope nope nope nope nope nope nope nope nope nope nope nope nope").toString("base64") } }, actor), /PNG/);
  check("document still 'sent' after failed attempts", (await docs.getDocument(draft.id, "default")).status === "sent");

  const sessT = await docs.resolveToken(tToken);
  await docs.markOpened(sessT!, actor);
  await docs.recordConsent(tToken, actor);
  const beforeSign = Date.now();
  await docs.completeSigning(tToken, { consent: true, values: { [F.tSig]: "signed" }, signature: { method: "drawn", png: sigPng(2) } }, actor);
  await rejects("double submit rejected", docs.completeSigning(tToken, { consent: true, values: {}, signature: { method: "drawn", png: sigPng(2) } }, actor), /already signed/);
  await flush();
  recs = await docs.recipientsOf(draft.id);
  check("Travis signed", recs.find((r) => r.id === travis)?.status === "signed");
  check("Michael invited after Travis signed", recs.find((r) => r.id === michael)?.status === "sent" && !!(await mailTo("michael@client.example", /Signature requested/)));
  const tDateRow = (await docs.fieldsOf(draft.id)).find((f) => f.id === F.tDate)!;
  check("Travis's date auto-filled with the signing instant (UTC)", !!tDateRow.value && Math.abs(new Date(tDateRow.value).getTime() - beforeSign) < 10_000);
  const sigRow = (await docs.fieldsOf(draft.id)).find((f) => f.id === F.tSig)!;
  check("signature image encrypted at rest", sigRow.valueImage?.subarray(0, 4).toString() === "TSE1");

  // in-progress view for Michael shows Travis's completed fields, still 5 pages
  const mToken = linkIn(String((await mailTo("michael@client.example", /Signature requested/))?.html ?? ""))!;
  const sessM = await docs.resolveToken(mToken);
  const prog = await docs.inProgressPdf(sessM!.document);
  check("in-progress PDF still 5 pages", (await PDFDocument.load(prog)).getPageCount() === 5);
  check("in-progress PDF shows Travis's signature, not Michael's", (await imagesOnPage(prog, 5)).length === 1);

  await rejects("Michael: required name can't be blank", docs.completeSigning(mToken, { consent: true, values: { [F.mName]: "   " }, signature: { method: "typed", png: sigPng(3), text: "Michael Client" } }, actor), /Full name|name/);
  await docs.completeSigning(mToken, { consent: true, values: { [F.mName]: "Michael A. Client", [F.mSig]: "signed" }, signature: { method: "typed", png: sigPng(3), text: "Michael Client" } }, actor);
  await flush();

  const done = await docs.getDocument(draft.id, "default");
  check("document completed", done.status === "completed" && !!done.completedAt);
  const signed = openBlob(done.completedPdf)!;
  const signedDoc = await PDFDocument.load(signed);
  check("FINAL PDF HAS EXACTLY 5 PAGES (no receipt page)", signedDoc.getPageCount() === 5, signedDoc.getPageCount());
  check("final PDF carries a PKCS#7 digital seal", done.sealed && signed.includes(Buffer.from("/adbe.pkcs7.detached")));
  check("separate audit trail generated", !!openBlob(done.auditPdf) && (await PDFDocument.load(openBlob(done.auditPdf)!)).getPageCount() >= 1);

  const p5 = await textOnPage(signed, 5);
  const near = (s: string, u: number, v: number, tol = 0.03) => p5.items.find((i) => i.str.includes(s) && Math.abs(i.u - u) < tol && Math.abs(i.v - v) < tol);
  check("Michael's printed name inside its box on page 5", !!near("Michael A. Client", 0.55, 0.78 + 0.025), p5.items);
  const year = String(new Date().getUTCFullYear());
  check("Travis's date inside its box on page 5", !!near(year, 0.1, 0.78 + 0.025), p5.items);
  check("Michael's date inside its box on page 5", !!near(year, 0.55, 0.83 + 0.025), p5.items);
  const imgs = await imagesOnPage(signed, 5);
  const inside = (b: { u0: number; v0: number; u1: number; v1: number }, x: number, y: number, w: number, h: number) => b.u0 >= x - 0.005 && b.u1 <= x + w + 0.005 && b.v0 >= y - 0.005 && b.v1 <= y + h + 0.005;
  check("two signature images on page 5", imgs.length === 2, imgs);
  check("Travis's signature inside his box", imgs.some((b) => inside(b, 0.1, 0.7, 0.3, 0.06)), imgs);
  check("Michael's signature inside his box", imgs.some((b) => inside(b, 0.55, 0.7, 0.3, 0.06)), imgs);
  check("pages 1–4 untouched (no stamp/footer)", (await imagesOnPage(signed, 1)).length === 0 && (await textOnPage(signed, 1)).items.map((i) => i.str).join("") === "Contract page 1");
  check("optional field left blank is not drawn", !(await textOnPage(signed, 3)).items.some((i) => i.str.includes("Case number")));

  const chain = await verifyAuditChain(draft.id);
  check("audit chain verifies", chain.ok && chain.sealedEvents >= 10, chain);
  // tamper with one audit row → chain breaks
  const [ev] = await db.select().from(t.documentEvents).where(eq(t.documentEvents.documentId, draft.id)).limit(1);
  await db.update(t.documentEvents).set({ detail: "tampered" }).where(eq(t.documentEvents.id, ev.id));
  check("tampering with the audit log is detected", !(await verifyAuditChain(draft.id)).ok);
  await db.update(t.documentEvents).set({ detail: ev.detail }).where(eq(t.documentEvents.id, ev.id));

  for (const who of ["travis@bail.example", "michael@client.example"]) {
    const m = await mailTo(who, /Your signed copy/);
    const pdfs = (m?.attachments ?? []).filter((a) => a.contentType === "application/pdf");
    const signedAtt = pdfs.find((a) => /\(signed\)/.test(a.filename ?? ""));
    check(`${who} received the completed PDF`, !!signedAtt);
    check(`${who}'s copy is 5 pages and matches the stored hash`, !!signedAtt && (await PDFDocument.load(signedAtt.content)).getPageCount() === 5 && (await import("../src/lib/crypto")).sha256Hex(signedAtt.content) === done.completedSha256);
    check(`${who}'s audit trail is a separate attachment`, pdfs.some((a) => /audit trail/.test(a.filename ?? "")));
  }
  check("sender notified of completion", !!(await mailTo("travis@bail.example", /^Completed:/)));
  await rejects("completed document can't be signed again", docs.completeSigning(mToken, { consent: true, values: {}, signature: { method: "drawn", png: sigPng(1) } }, actor), /completed|already/);
  await rejects("completed document can't be voided", docs.voidDocument(draft.id, "default", "", actor), /out for signature/);

  // ══ Scenario B — multiple pages incl. rotated and cropped ═════════════
  console.log("\nB. Fields on rotated / cropped / differently sized pages");
  const mixed = await makePdf([
    { size: [612, 792] },
    { size: [612, 792], rotate: 90 },
    { size: [842, 595] },
    { size: [612, 792], rotate: 270, crop: [36, 50, 540, 700] },
    { size: [612, 792], rotate: 180 },
  ]);
  const d2 = await docs.createDraft({ orgId: "default", createdBy: "env", senderEmail: "owner@trace-studio.tech", senderName: "TRACE", file: mixed, fileName: "mixed.pdf" }, actor);
  const pages = docs.pagesOf(d2);
  check("rotated page reports displayed (swapped) size", pages[1].w === 792 && pages[1].h === 612 && pages[1].rotation === 90);
  check("cropped+rotated page uses CropBox", pages[3].w === 700 && pages[3].h === 540, pages[3]);
  const solo = id();
  const spots = pages.map((_, i) => ({ id: id(), recipientId: solo, type: "name", page: i, x: 0.6, y: 0.2, w: 0.3, h: 0.05, required: true, label: null, placeholder: null, defaultValue: null, options: {} }));
  const sigs = pages.map((_, i) => ({ id: id(), recipientId: solo, type: "signature", page: i, x: 0.15, y: 0.6, w: 0.3, h: 0.1, required: true, label: null, placeholder: null, defaultValue: null, options: {} }));
  await docs.saveDraft(d2.id, "default", docs.draftInput.parse({ title: "Mixed", signingOrder: "parallel", recipients: [{ id: solo, name: "Melissa", email: "melissa@client.example", order: 1 }], fields: [...spots, ...sigs] }));
  await docs.sendDocument(d2.id, "default", actor);
  await docs.completeSigning(signingToken(solo, 1, Date.now() + 3600_000), { consent: true, values: {}, signature: { method: "drawn", png: sigPng(5) } }, actor);
  const d2done = await docs.getDocument(d2.id, "default");
  const out2 = openBlob(d2done.completedPdf)!;
  check("mixed document completed with 5 pages", d2done.status === "completed" && (await PDFDocument.load(out2)).getPageCount() === 5);
  for (let i = 0; i < 5; i++) {
    const { items } = await textOnPage(out2, i + 1);
    const nm = items.find((x) => x.str === "Melissa");
    check(`page ${i + 1} (rot ${pages[i].rotation}°): name upright at its box`, !!nm && Math.abs(nm.u - 0.6) < 0.03 && nm.v > 0.2 && nm.v < 0.26, nm ?? items);
    const im = await imagesOnPage(out2, i + 1);
    check(`page ${i + 1}: signature inside its box`, im.length === 1 && inside(im[0], 0.15, 0.6, 0.3, 0.1), im);
  }

  // ══ Templates ═════════════════════════════════════════════════════════
  console.log("\nTemplates");
  const tpl = await templates.createTemplateFromDocument(draft.id, "default", "Bail agreement template", false);
  check("template keeps PDF, roles and all fields", templates.rolesOf(tpl).length === 2 && templates.templateFieldsOf(tpl).length === 6 && tpl.pageCount === 5);
  const roles = templates.rolesOf(tpl);
  const fromTpl = await templates.createFromTemplate(
    tpl.id,
    "default",
    { userId: "env", email: "travis@bail.example", name: "Travis" },
    templates.useTemplateInput.parse({ recipients: { [roles[0].key]: { name: "Travis", email: "travis@bail.example" }, [roles[1].key]: { name: "Melissa", email: "melissa@client.example" } }, send: true }),
    actor,
  );
  check("document from template is sent with fields copied", fromTpl.status === "sent" && (await docs.fieldsOf(fromTpl.id)).length === 6);
  check("template document keeps sequential order", (await docs.recipientsOf(fromTpl.id)).map((r) => r.status).join(",") === "sent,pending");

  // ══ Decline & void ════════════════════════════════════════════════════
  console.log("\nDecline / void");
  const fr = await docs.recipientsOf(fromTpl.id);
  await docs.declineAsRecipient(signingToken(fr[0].id, fr[0].tokenVersion, Date.now() + 3600_000), "Wrong amount", actor);
  check("decline closes the document", (await docs.getDocument(fromTpl.id, "default")).status === "declined");
  await flush();
  check("sender told about the decline", !!(await mailTo("travis@bail.example", /^Declined:/)));
  check("pending (never invited) recipient not emailed about the cancellation", !(await mailTo("melissa@client.example", /cancelled: Bail/)));

  // ══ Webhooks (CRM integration) ════════════════════════════════════════
  console.log("\nWebhooks");
  const { createServer } = await import("http");
  const { createHmac } = await import("crypto");
  const hits: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  const hookSrv = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      hits.push({ headers: req.headers, body: b });
      res.writeHead(hits.length === 1 ? 500 : 200).end("ok"); // first delivery fails → retried
    });
  });
  await new Promise<void>((r) => hookSrv.listen(18099, "127.0.0.1", r));
  const webhooks = await import("../src/lib/webhooks");
  const { secret } = await webhooks.createEndpoint("default", "http://127.0.0.1:18099/hook", ["document.completed", "recipient.signed"]);
  await rejects("webhook URLs must be https (except localhost)", webhooks.createEndpoint("default", "http://crm.example.com/hook", []), /https/);
  const d3 = await docs.createDraft({ orgId: "default", createdBy: "env", senderEmail: "owner@trace-studio.tech", senderName: "TRACE", file: five, fileName: "hook.pdf" }, actor);
  const solo3 = id();
  await docs.saveDraft(d3.id, "default", docs.draftInput.parse({ title: "Hook", recipients: [{ id: solo3, name: "Hook Signer", email: "hook@client.example", order: 1 }], fields: [{ id: id(), recipientId: solo3, type: "signature", page: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.06 }] }));
  await docs.sendDocument(d3.id, "default", actor);
  await docs.completeSigning(signingToken(solo3, 1, Date.now() + 3600_000), { consent: true, values: {}, signature: { method: "drawn", png: sigPng(9) } }, actor);
  await webhooks.processWebhooks();
  await db.update(t.webhookDeliveries).set({ nextAttemptAt: new Date() });
  await webhooks.processWebhooks();
  const events = hits.map((h) => JSON.parse(h.body).event as string);
  check("subscribed events delivered (signed + completed), others filtered", events.includes("recipient.signed") && events.includes("document.completed") && !events.includes("document.sent"), events);
  const sigHdr = String(hits[hits.length - 1].headers["x-tracesign-signature"]);
  const [, ts, v1] = sigHdr.match(/^t=(\d+),v1=([a-f0-9]{64})$/) ?? [];
  check("webhook signature verifies with the endpoint secret", !!v1 && createHmac("sha256", secret).update(`${ts}.${hits[hits.length - 1].body}`).digest("hex") === v1, sigHdr);
  const rows = await db.select().from(t.webhookDeliveries);
  check("failed delivery retried, then marked sent", rows.every((r) => r.status === "sent") && rows.some((r) => r.attempts === 2), rows.map((r) => `${r.event}:${r.status}:${r.attempts}`));
  hookSrv.close();

  // ══ Isolation between workspaces ══════════════════════════════════════
  console.log("\nWorkspace isolation");
  await db.insert(t.organizations).values({ id: "acme", name: "Acme Bail", brandName: "ACME BAIL.SIGN" });
  await rejects("another workspace can't read a document", docs.getDocument(draft.id, "acme"), /not found/);
  await rejects("another workspace can't send it", docs.sendDocument(d3.id, "acme", actor), /not found/);
  await rejects("another workspace can't void it", docs.voidDocument(fromTpl.id, "acme", "", actor), /not found/);
  await rejects("another workspace can't use a template", templates.getTemplate(tpl.id, "acme"), /not found/i);
  const rem = fr.find((r) => r.status !== "declined");
  if (rem) await rejects("another workspace can't send reminders", docs.sendReminder(rem.id, { manual: true, orgId: "acme" }), /not found/i);

  // ══ Retention ═════════════════════════════════════════════════════════
  console.log("\nData retention");
  await db.update(t.organizations).set({ retentionDays: 30 }).where(eq(t.organizations.id, "default"));
  await db.update(t.documents).set({ updatedAt: new Date(Date.now() - 40 * 86400_000) }).where(eq(t.documents.id, d2.id));
  const purged = await docs.purgeExpiredData();
  check("finished documents past retention are deleted", purged === 1 && !(await db.select().from(t.documents).where(eq(t.documents.id, d2.id))).length);
  check("recent documents are kept", (await db.select().from(t.documents).where(eq(t.documents.id, draft.id))).length === 1);

  await outbox.processOutbox({ limit: 100 });
  smtp.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
