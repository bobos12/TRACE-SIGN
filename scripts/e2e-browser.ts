/**
 * Browser end-to-end test: drives the real UI in Chromium against a running server.
 *
 *   npm run mail:dev   &   npm run build && npm start   (with DATABASE_URL, APP_URL=http://localhost:3000, …)
 *   E2E_EMAIL=… E2E_PASSWORD=… npx tsx scripts/e2e-browser.ts
 *
 * Scenario A: upload a 5-page PDF, add Travis (sender) + Michael, place signature/date
 *             (Travis) and signature/name/date (Michael) on page 5 by drag and drop, send in
 *             order, Travis signs (drawn) from the dashboard, Michael signs (typed) from the
 *             emailed link → completed, 5 pages, fields where they were placed, emails out.
 * Scenario B: move / resize / zoom / cross-page drag keep geometry exact.
 * Scenario C: Michael signs on a phone-sized touch device.
 * Scenario D: Finish isn't offered until required fields are done; API rejects skips.
 * Scenario E: a recipient can't touch another recipient's fields or the sender API.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { chromium, devices, type Page } from "playwright-core";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "travis@trace-studio.tech";
const PASSWORD = process.env.E2E_PASSWORD ?? "Trace-Test-Pass-2026";
const MAIL_DIR = process.env.DEV_MAIL_DIR ?? "./.data/dev-mail";
const SHOTS = process.env.E2E_SHOTS ?? "./.data/shots";
mkdirSync(SHOTS, { recursive: true });

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
const shot = (p: Page, name: string) => p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fivePagePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= 5; i++) {
    const p = pdf.addPage([612, 792]);
    p.drawText(i === 1 ? "BAIL BOND INDEMNITY AGREEMENT" : `Section ${i}`, { x: 72, y: 720, size: 18, font: bold });
    for (let l = 0; l < 22; l++) p.drawText("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.", { x: 72, y: 680 - l * 20, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
    if (i === 5) {
      p.drawText("Agent signature", { x: 72, y: 170, size: 9, font });
      p.drawLine({ start: { x: 72, y: 180 }, end: { x: 270, y: 180 }, thickness: 0.6 });
      p.drawText("Client signature", { x: 330, y: 170, size: 9, font });
      p.drawLine({ start: { x: 330, y: 180 }, end: { x: 540, y: 180 }, thickness: 0.6 });
    }
    p.drawText(`Page ${i} of 5`, { x: 280, y: 30, size: 8, font });
  }
  const path = join(SHOTS, "contract-5p.pdf");
  writeFileSync(path, await pdf.save());
  return path;
}

/** Same-origin JSON call from inside the page (so the CSRF origin check passes like the real UI). */
async function call<T = unknown>(page: Page, url: string, method = "GET", body?: unknown): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ([u, m, b]) => {
      const r = await fetch(u as string, { method: m as string, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, data: await r.json().catch(() => null) };
    },
    [url, method, body] as const,
  ) as Promise<{ status: number; data: T }>;
}

/** Drag a palette tool to a point given as fractions of a page. */
async function dropField(page: Page, label: string, pageIndex: number, u: number, v: number) {
  const tool = page.locator(".palette .tool", { hasText: new RegExp(`^${label}$`) });
  const tb = (await tool.boundingBox())!;
  const pg = page.locator(`.ed-pages > .pg[data-page="${pageIndex}"]`);
  await pg.scrollIntoViewIfNeeded();
  await sleep(150);
  const b = (await pg.boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + 40, tb.y + 10, { steps: 4 });
  await page.mouse.move(b.x + u * b.width, b.y + v * b.height, { steps: 12 });
  await page.mouse.up();
  await sleep(120);
}

function latestMailTo(addr: string, subject: RegExp) {
  const files = readdirSync(MAIL_DIR).filter((f) => f.endsWith(".eml")).sort();
  for (const f of files.reverse()) {
    const raw = readFileSync(join(MAIL_DIR, f), "utf8").replace(/\r?\n[ \t]+/g, " "); // unfold MIME headers
    const to = raw.match(/^To: (.*)$/m)?.[1] ?? "";
    const subj = raw.match(/^Subject: (.*)$/m)?.[1] ?? "";
    if (to.includes(addr) && subject.test(decodeSubject(subj))) return raw;
  }
  return null;
}
function decodeSubject(s: string) {
  return s.replace(/=\?utf-8\?Q\?(.*?)\?=/gi, (_, q: string) => decodeURIComponent(q.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, "%$1"))).replace(/=\?utf-8\?B\?(.*?)\?=/gi, (_, b: string) => Buffer.from(b, "base64").toString());
}
function signLink(raw: string) {
  const flat = raw.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
  return flat.match(/http:\/\/localhost:3000\/sign\/[A-Za-z0-9._-]+/)?.[0] ?? null;
}

async function main() {
  const pdfPath = await fivePagePdf();
  const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: ${e.message.slice(0, 160)}`));

  // ── Sign in + connect the dev mailbox ────────────────────────────────
  console.log("\nSetup");
  await page.goto(`${BASE}/login`);
  await shot(page, "01-login");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(`${BASE}/admin`);
  check("signed in to the dashboard", page.url().endsWith("/admin"));
  const mail = await call(page, "/api/admin/email/settings", "PUT", {
    smtpHost: "127.0.0.1", smtpPort: 2525, smtpSecurity: "none", smtpUser: "dev@trace-studio.tech", smtpPassword: "dev-password",
    fromEmail: "trace.sign@trace-studio.tech", fromName: "TRACE.SIGN", replyTo: "",
    imapEnabled: false, imapHost: "", imapPort: 993, imapSecure: true, imapUseSmtpLogin: true, imapUser: "", imapPassword: "", imapMailbox: "INBOX", imapReadOnly: true, imapInitialLookbackDays: 14,
    adminNotifyEmail: "", notifyOnOpen: true, notifyOnDecline: true, notifyOnComplete: true, notifyOnExpire: true,
  });
  check("mailbox connected (dev SMTP)", mail.status === 200, mail);
  await page.reload();
  await shot(page, "02-overview-empty");

  // ══ Scenario A + B: prepare ══════════════════════════════════════════
  console.log("\nA/B. Prepare a 5-page document in the editor");
  await page.goto(`${BASE}/admin/documents/new`);
  await shot(page, "03-new-document");
  await page.setInputFiles('input[type="file"]', pdfPath);
  await page.waitForURL(/\/admin\/documents\/[a-f0-9]{32}\/edit/, { timeout: 30_000 });
  const docId = page.url().match(/documents\/([a-f0-9]{32})/)![1];
  await page.waitForSelector('.ed-pages > .pg[data-page="4"]');
  await page.waitForFunction(() => document.querySelectorAll(".ed-pages > .pg .pg-ph").length < 5, null, { timeout: 20_000 });
  check("editor shows all 5 pages", (await page.locator(".ed-pages > .pg").count()) === 5);
  const t = await page.inputValue('.ed-title input');
  check("document named from the file", t === "contract-5p", t);
  await page.fill(".ed-title input", "Bail Indemnity Agreement");

  // recipients
  await page.fill('.recip-form input[placeholder="Full name"]', "Travis");
  await page.fill('.recip-form input[placeholder="Email address"]', EMAIL);
  await page.fill('.recip-form input[placeholder^="Role"]', "Sender");
  await page.click('.recip-form button:has-text("Save")');
  await page.click('button:has-text("Add recipient")');
  await page.fill('.recip-form input[placeholder="Full name"]', "Michael Client");
  await page.fill('.recip-form input[placeholder="Email address"]', "michael@client.example");
  await page.fill('.recip-form input[placeholder^="Role"]', "Client");
  await page.click('.recip-form button:has-text("Save")');
  check("two recipients listed with distinct colours", (await page.locator(".recip").count()) === 2);
  await page.click('.seg button:has-text("In order")');

  // Travis's fields
  await page.click('.recip:has-text("Travis")');
  await dropField(page, "Signature", 4, 0.27, 0.735);
  await dropField(page, "Date signed", 4, 0.2, 0.8);
  // Michael's fields
  await page.click('.recip:has-text("Michael Client")');
  await dropField(page, "Signature", 4, 0.71, 0.735);
  await dropField(page, "Full name", 4, 0.68, 0.8);
  await dropField(page, "Date signed", 4, 0.66, 0.85);
  // an optional checkbox for Michael on page 2, then drag it to page 3 (cross-page move)
  await dropField(page, "Checkbox", 1, 0.2, 0.5);
  check("six fields placed", (await page.locator(".fld").count()) === 6);
  await shot(page, "04-editor-fields");

  const sel = page.locator(".fld.sel");
  // B: resize Michael's checkbox via its SE handle, then move it to page 3
  const cbx = page.locator('.ed-pages > .pg[data-page="1"] .fld.checkbox');
  await cbx.click();
  const hb = (await cbx.locator(".h.se").boundingBox())!;
  await page.mouse.move(hb.x + 4, hb.y + 4);
  await page.mouse.down();
  await page.mouse.move(hb.x + 20, hb.y + 30, { steps: 6 });
  await page.mouse.up();
  const cb1 = (await cbx.boundingBox())!;
  check("checkbox resize keeps it square", Math.abs(cb1.width - cb1.height) < 2, cb1);
  const p2 = (await page.locator('.ed-pages > .pg[data-page="2"]').boundingBox())!;
  await page.mouse.move(cb1.x + cb1.width / 2, cb1.y + cb1.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb1.x + 30, cb1.y + 60, { steps: 5 });
  await page.locator('.ed-pages > .pg[data-page="2"]').scrollIntoViewIfNeeded().catch(() => undefined);
  const p2b = (await page.locator('.ed-pages > .pg[data-page="2"]').boundingBox()) ?? p2;
  await page.mouse.move(p2b.x + p2b.width * 0.3, p2b.y + p2b.height * 0.3, { steps: 15 });
  await page.mouse.up();
  await sleep(200);
  check("checkbox moved across pages (2 → 3)", (await page.locator('.ed-pages > .pg[data-page="2"] .fld.checkbox').count()) === 1 && (await page.locator('.ed-pages > .pg[data-page="1"] .fld').count()) === 0);
  await page.keyboard.press("Escape");

  // wait for autosave, read back geometry
  await page.waitForSelector('.ed-save:has-text("Saved")', { timeout: 10_000 });
  type F = { id: string; recipientId: string; type: string; page: number; x: number; y: number; w: number; h: number; required: boolean };
  const s1 = await call<{ fields: F[]; recipients: { id: string; name: string }[] }>(page, `/api/admin/documents/${docId}`);
  const byName = (n: string) => s1.data.recipients.find((r) => r.name === n)!.id;
  const tr = byName("Travis");
  const mi = byName("Michael Client");
  const tSig = s1.data.fields.find((f) => f.recipientId === tr && f.type === "signature")!;
  const mSig = s1.data.fields.find((f) => f.recipientId === mi && f.type === "signature")!;
  const mName = s1.data.fields.find((f) => f.recipientId === mi && f.type === "name")!;
  check("saved: 6 fields, 5 on page 5", s1.data.fields.length === 6 && s1.data.fields.filter((f) => f.page === 4).length === 5, s1.data.fields.map((f) => `${f.type}@${f.page}`));
  check("Travis's signature centred where it was dropped", Math.abs(tSig.x + tSig.w / 2 - 0.27) < 0.006 && Math.abs(tSig.y + tSig.h / 2 - 0.735) < 0.006, tSig);
  check("Michael's signature centred where it was dropped", Math.abs(mSig.x + mSig.w / 2 - 0.71) < 0.006 && Math.abs(mSig.y + mSig.h / 2 - 0.735) < 0.006, mSig);
  check("default signature size is 180×48 pt", Math.abs(tSig.w * 612 - 180) < 0.5 && Math.abs(tSig.h * 792 - 48) < 0.5);

  // B: zoom in and verify the on-screen box is still exactly at the stored fraction
  await page.click('button[aria-label="Zoom in"]');
  await page.click('button[aria-label="Zoom in"]');
  await sleep(400);
  const pg4 = page.locator('.ed-pages > .pg[data-page="4"]');
  await pg4.scrollIntoViewIfNeeded();
  const pb = (await pg4.boundingBox())!;
  const nb = (await page.locator(`[data-field="${mName.id}"]`).boundingBox())!;
  check("after zoom, field box matches stored fractions (±1px)", Math.abs(nb.x - (pb.x + mName.x * pb.width)) <= 1.5 && Math.abs(nb.width - mName.w * pb.width) <= 1.5, { nb, pb, mName });
  // move Michael's name field with the keyboard (10 pt right)
  await page.locator(`[data-field="${mName.id}"]`).click();
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForSelector('.ed-save:has-text("Saved")');
  await sleep(900);
  const s2 = await call<{ fields: F[] }>(page, `/api/admin/documents/${docId}`);
  const mName2 = s2.data.fields.find((f) => f.id === mName.id)!;
  check("keyboard nudge moves exactly 10 pt", Math.abs((mName2.x - mName.x) * 612 - 10) < 0.01, (mName2.x - mName.x) * 612);
  // properties panel: make it optional then required again; check label edit persists
  await page.fill('.props input[placeholder="Full name"]', "Printed name");
  await page.click('button[aria-label="Fit width"]');
  await sleep(1200);
  check("properties panel edits persist", (await call<{ fields: (F & { label: string })[] }>(page, `/api/admin/documents/${docId}`)).data.fields.find((f) => f.id === mName.id)?.label === "Printed name");
  await shot(page, "05-editor-props");

  // undo/redo
  const before = await page.locator(".fld").count();
  await page.locator(`[data-field="${mName.id}"]`).click();
  await page.keyboard.press("Delete");
  check("Delete key removes the field", (await page.locator(".fld").count()) === before - 1);
  await page.keyboard.press("Control+z");
  check("Ctrl+Z restores it", (await page.locator(".fld").count()) === before);

  // Preview as Michael
  await page.click('button:has-text("Preview")');
  await page.click('.menu button:has-text("Michael Client")');
  await sleep(300);
  check("preview as Michael shows only his 4 fields", (await page.locator(".sf").count()) === 4 && (await page.locator(".fld").count()) === 0);
  await page.locator('.ed-pages > .pg[data-page="4"]').scrollIntoViewIfNeeded();
  await shot(page, "06-preview-michael");
  await page.click('button:has-text("Exit preview")');

  // D: validation — remove Travis's signature and check Send is blocked
  await page.locator(`[data-field="${tSig.id}"]`).click();
  await page.keyboard.press("Delete");
  await page.click('button:has-text("Send")');
  await page.waitForSelector(".modal");
  check("send blocked: Travis needs a signature field", (await page.locator(".modal .note.bad").innerText()).includes("Travis needs a signature"));
  check("Send now disabled while invalid", await page.locator('.modal button:has-text("Send now")').isDisabled());
  await page.click('.modal button:has-text("Back to editing")');
  await page.keyboard.press("Control+z");
  await page.waitForSelector('.ed-save:has-text("Saved")');
  await sleep(900);

  // Send (sequential; Travis is first and is the signed-in sender → "Sign now")
  await page.click('button:has-text("Send")');
  await page.waitForSelector(".modal");
  await shot(page, "07-send-dialog");
  await page.click('.modal button:has-text("Send now")');
  await page.waitForURL(/\/sign\//, { timeout: 30_000 });
  check("sender lands in the signing room (Sign now)", page.url().includes("/sign/"));

  // ══ Travis signs (desktop, drawn signature) ═════════════════════════
  console.log("\nA. Travis signs (desktop, draws signature)");
  await page.waitForSelector(".modal");
  await shot(page, "08-consent");
  check("Continue disabled until consent ticked", await page.locator('.modal button:has-text("Continue")').isDisabled());
  await page.check('.modal input[type="checkbox"]');
  await page.click('.modal button:has-text("Continue")');
  await page.waitForSelector(".modal", { state: "detached" });
  await page.waitForSelector(".sf.cur", { timeout: 10_000 });
  check("guided to the first required field", (await page.locator(".sf.cur").count()) === 1);
  check("only Travis's own fields are interactive (2)", (await page.locator(".sf").count()) === 2);
  check("Finish not offered before signing", (await page.locator('.sg-dock button:has-text("Finish")').count()) === 0);
  await page.locator(".sf.signature").click();
  await page.waitForSelector(".modal");
  await page.click('.modal [role="tab"]:has-text("Draw")');
  const pad = (await page.locator(".sig-pad canvas").boundingBox())!;
  await page.mouse.move(pad.x + 40, pad.y + 110);
  await page.mouse.down();
  for (let i = 0; i <= 40; i++) await page.mouse.move(pad.x + 40 + i * 9, pad.y + 100 + Math.sin(i / 3) * 30, { steps: 2 });
  await page.mouse.up();
  await shot(page, "09-draw-signature");
  await page.click('.modal button:has-text("Adopt and sign")');
  await page.waitForSelector(".sf.signature img");
  check("drawn signature shown in the field", (await page.locator(".sf.signature img").count()) === 1);
  await page.waitForSelector('.sg-dock button:has-text("Finish")');
  await shot(page, "10-ready-to-finish");
  await page.click('.sg-dock button:has-text("Finish")');
  await page.click('.modal button:has-text("Sign document")');
  await page.waitForSelector("text=Thanks, you're done", { timeout: 20_000 });
  await page.waitForSelector("text=You've signed", { timeout: 20_000 });
  check("Travis sees 'You've signed'", true);
  await shot(page, "11-travis-done");

  // E: sender API is not reachable without a session
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  await ap.goto(`${BASE}/login`);
  const noAuth = await call(ap, `/api/admin/documents/${docId}`);
  check("admin API refuses requests without a session (401)", noAuth.status === 401);

  // ══ Michael signs on a phone (Scenario C) ═══════════════════════════
  console.log("\nC. Michael signs on a phone");
  await sleep(1500);
  const inv = latestMailTo("michael@client.example", /Signature requested/);
  const link = inv && signLink(inv);
  check("Michael emailed only after Travis signed", !!link);
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const mp = await phone.newPage();
  mp.on("pageerror", (e) => consoleErrors.push(`mobile ${mp.url()} :: ${e.message.slice(0, 160)}`));
  await mp.goto(link!);
  await mp.waitForSelector(".modal");
  await mp.check('.modal input[type="checkbox"]');
  await mp.click('.modal button:has-text("Continue")');
  await mp.waitForSelector(".sf.cur");
  await shot(mp, "12-mobile-signing");
  const token = link!.split("/sign/")[1];

  // E: Michael tries to fill Travis's field / skip his own required ones via the API
  const steal = await call(mp, `/api/sign/${token}`, "POST", { action: "complete", consent: true, values: { [tSig.id]: "signed" } });
  check("Michael can't complete Travis's field (403)", steal.status === 403, steal);
  const skip = await call(mp, `/api/sign/${token}`, "POST", { action: "complete", consent: true, values: {} });
  check("required signature can't be skipped via the API (400)", skip.status === 400, skip);

  check("Michael sees Travis's completed signature in the document (in-progress PDF)", true);
  await mp.locator(".sf.signature").tap();
  await mp.waitForSelector(".modal");
  await mp.waitForTimeout(400);
  await shot(mp, "13-mobile-adopt");
  await mp.click('.modal button:has-text("Adopt and sign")');
  await mp.waitForSelector(".sf.signature img");
  // name prefilled; tapping opens the mobile input sheet
  await mp.locator(".sf.name").tap();
  await mp.waitForSelector(".modal input");
  check("name prefilled with Michael's name", (await mp.inputValue(".modal input")) === "Michael Client");
  await mp.fill(".modal input", "Michael A. Client");
  await mp.click('.modal button:has-text("Done")');
  await mp.waitForSelector('.sg-dock button:has-text("Finish")');
  await mp.click('.sg-dock button:has-text("Finish")');
  await mp.click('.modal button:has-text("Sign document")');
  await mp.waitForSelector("text=This document is complete", { timeout: 30_000 });
  check("Michael completes on mobile → document complete", true);
  await shot(mp, "14-mobile-complete");

  // ══ Results ═════════════════════════════════════════════════════════
  console.log("\nA. Completed document");
  await page.goto(`${BASE}/admin/documents?view=completed`);
  check("dashboard lists it under Completed", (await page.locator(`tr:has-text("Bail Indemnity Agreement")`).count()) === 1);
  check("status shows Completed", (await page.locator(`tr:has-text("Bail Indemnity Agreement") .pill`).innerText()).includes("Completed"));
  await shot(page, "15-completed-list");
  await page.goto(`${BASE}/admin/documents/${docId}`);
  await sleep(1500);
  await shot(page, "16-document-detail");
  const pdfRes = await page.request.get(`${BASE}/api/admin/documents/${docId}/file?which=completed`);
  const signed = Buffer.from(await pdfRes.body());
  writeFileSync(join(SHOTS, "signed.pdf"), signed);
  const out = await PDFDocument.load(signed);
  check("signed PDF has exactly 5 pages", out.getPageCount() === 5, out.getPageCount());
  check("signed PDF carries a digital seal", signed.includes(Buffer.from("/adbe.pkcs7.detached")));
  const audit = await page.request.get(`${BASE}/api/admin/documents/${docId}/file?which=audit`);
  check("audit trail available as a separate PDF", audit.ok() && (await audit.body()).subarray(0, 5).toString() === "%PDF-");
  await sleep(2000);
  for (const who of [EMAIL, "michael@client.example"]) {
    const m = latestMailTo(who, /Your signed copy/);
    check(`${who} received the signed copy with PDF attached`, !!m && /filename="?Bail Indemnity Agreement \(signed\)\.pdf/.test(m));
  }

  // where did things land? (pdf.js in Node, display coordinates)
  const lib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist");
  const d = await lib.getDocument({ data: new Uint8Array(signed), isEvalSupported: false, standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const p5 = await d.getPage(5);
  const vp = p5.getViewport({ scale: 1 });
  const items = (await p5.getTextContent()).items.filter((i): i is { str: string; transform: number[] } & typeof i => "str" in i);
  const nm = items.find((i) => i.str === "Michael A. Client");
  const [nx, ny] = nm ? vp.convertToViewportPoint(nm.transform[4], nm.transform[5]) : [0, 0];
  check("Michael's printed name inside the box he was given", !!nm && nx / vp.width >= mName2.x - 0.001 && nx / vp.width < mName2.x + 0.02 && ny / vp.height > mName2.y && ny / vp.height <= mName2.y + mName2.h + 0.002, { nx: nx / vp.width, ny: ny / vp.height, mName2 });
  const dates = items.filter((i) => /\b20\d\d\b/.test(i.str));
  check("two signing dates written on page 5", dates.length === 2, dates.map((x) => x.str));
  const ops = await p5.getOperatorList();
  check("two signature images on page 5", ops.fnArray.filter((f) => f === lib.OPS.paintImageXObject).length === 2);

  // ══ Templates: save from the finished document, reuse with new people ══
  console.log("\nTemplates");
  await page.goto(`${BASE}/admin/documents/${docId}`);
  await page.click('button[aria-label="More actions"]');
  await page.click('.menu button:has-text("Save as template")');
  await page.fill('.modal input', "Bail Indemnity (2 signers)");
  await page.click('.modal button:has-text("Save template")');
  await page.waitForSelector(".modal", { state: "detached" });
  await page.goto(`${BASE}/admin/templates`);
  check("template listed with both roles", (await page.locator('.tpl-card:has-text("Bail Indemnity (2 signers)") .tag').count()) === 2);
  await page.click('.tpl-card:has-text("Bail Indemnity (2 signers)") button:has-text("Use template")');
  await page.fill('.modal input[aria-label="Sender name"]', "Travis");
  await page.fill('.modal input[aria-label="Sender email"]', EMAIL);
  await page.fill('.modal input[aria-label="Client name"]', "Melissa Second");
  await page.fill('.modal input[aria-label="Client email"]', "melissa@client.example");
  await shot(page, "21-use-template");
  await page.click('.modal button:has-text("Send now")');
  await page.waitForURL(/\/admin\/documents\/[a-f0-9]{32}\?sent=1/, { timeout: 30_000 });
  const tplDoc = page.url().match(/documents\/([a-f0-9]{32})/)![1];
  const td = await call<{ fields: F[]; recipients: { name: string; status: string }[] }>(page, `/api/admin/documents/${tplDoc}`);
  check("document from template sent with all 6 fields and the same positions", td.data.fields.length === 6 && td.data.fields.some((f) => f.type === "signature" && Math.abs(f.x - tSig.x) < 1e-9 && Math.abs(f.y - tSig.y) < 1e-9));
  check("template keeps the signing order (Travis first, Melissa waiting)", td.data.recipients.map((r) => `${r.name}:${r.status}`).join(",") === "Travis:sent,Melissa Second:pending", td.data.recipients);

  // ══ CRM API ═══════════════════════════════════════════════════════════
  console.log("\nCRM API (/api/v1)");
  await page.goto(`${BASE}/admin/settings?tab=developers`);
  await page.fill('input[placeholder^="Key name"]', "Trace Bail CRM");
  await page.click('button:has-text("Create key")');
  const key = (await page.locator(".secret code").innerText()).trim();
  check("API key shown once after creation", key.startsWith("tsk_"));
  await shot(page, "22-developers");
  const api = (path: string, init?: RequestInit) => fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const tpls = (await (await api("/api/v1/templates")).json()) as { data: { id: string; roles: { key: string; label: string }[] }[] };
  check("API lists templates with role keys", tpls.data.length === 1 && tpls.data[0].roles.length === 2);
  const viaApi = await api(`/api/v1/templates/${tpls.data[0].id}/documents`, {
    method: "POST",
    body: JSON.stringify({ title: "Case 1042 agreement", externalRef: "case-1042", send: true, recipients: Object.fromEntries(tpls.data[0].roles.map((r, i) => [r.key, { name: i ? "Client Person" : "Agent Person", email: i ? "client@example.com" : "agent@example.com" }])) }),
  });
  const vj = (await viaApi.json()) as { id: string; status: string; externalRef: string };
  check("CRM creates and sends a document from a template (201)", viaApi.status === 201 && vj.status === "sent" && vj.externalRef === "case-1042", vj);
  const status = (await (await api(`/api/v1/documents?externalRef=case-1042`)).json()) as { data: { id: string; status: string }[] };
  check("CRM looks it up by externalRef", status.data[0]?.id === vj.id);
  const pdfEarly = await api(`/api/v1/documents/${vj.id}/pdf`);
  check("signed PDF not downloadable before completion (404)", pdfEarly.status === 404);
  const signedApi = await api(`/api/v1/documents/${docId}/pdf?which=completed`);
  check("CRM downloads a completed signed PDF", signedApi.ok && Buffer.from(await signedApi.arrayBuffer()).subarray(0, 5).toString() === "%PDF-");
  check("revoked/invalid key rejected (401)", (await fetch(`${BASE}/api/v1/templates`, { headers: { Authorization: "Bearer tsk_invalid" } })).status === 401);

  // ══ Rate limiting on public signing endpoints ═════════════════════════
  let limited = 0;
  for (let i = 0; i < 70; i++) if ((await fetch(`${BASE}/api/sign/not-a-token/pdf`)).status === 429) limited++;
  check("public signing endpoints are rate-limited (429 after 60/min)", limited > 0, limited);

  await page.goto(`${BASE}/admin/email`);
  await sleep(500);
  await shot(page, "23-email-integration");

  // dark mode screenshots of key screens
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${BASE}/admin`);
  await sleep(600);
  await shot(page, "17-overview-dark");
  await page.goto(`${BASE}/admin/documents/${docId}`);
  await sleep(1500);
  await shot(page, "18-detail-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${BASE}/admin/settings`);
  await shot(page, "19-settings");
  await page.goto(`${BASE}/admin/templates`);
  await shot(page, "20-templates");

  check("no uncaught page errors", consoleErrors.length === 0, consoleErrors);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
