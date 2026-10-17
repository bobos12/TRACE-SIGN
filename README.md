# TRACE.SIGN 2.0

Self-hosted electronic signatures by **TRACE.STUDIO**. Upload a PDF, add signers, drag signature / initials / name / date / text / email / checkbox fields onto the pages, preview as each signer, send (all at once or in order), and every party automatically receives the signed PDF. **The signed PDF keeps exactly its original pages**: no receipt or certificate page is ever added.

- **Stack:** Next.js 14 (App Router) · PostgreSQL via Drizzle ORM · pdf.js (rendering) · pdf-lib (writing) · @signpdf (PKCS#7 seal) · Nodemailer / ImapFlow (your own mailbox)
- **Sender:** `TRACE.SIGN <trace.sign@trace-studio.tech>` through your company SMTP. No paid e-signature or email service.

---

## What's new in 2.0

| Area | What it does |
|---|---|
| **Document editor** | PDF pages rendered exactly as in the file (pdf.js). Recipients with their own colours, field palette, drag-and-drop (or tap-to-place on touch), move, resize (handles), cross-page moves, delete, duplicate, keyboard nudge, undo/redo, zoom, properties panel (assignee, required/optional, label, placeholder, default value, date format, font size, max length, exact position in points), autosave. |
| **Exact positions** | Fields are stored as fractions of the page *as displayed* (rotation and CropBox applied). They're independent of screen size, zoom and pixel density, and map back onto PDF coordinates at finalization, including rotated (90/180/270°) and cropped pages. |
| **Preview & validation** | *Preview as recipient* shows exactly what one signer sees. Sending is blocked until every signer has a name, a valid unique email and at least one signature/initials field (checked in the browser and again on the server). |
| **Signing order** | Parallel (everyone at once) or sequential (each person is emailed when the previous step is finished; ties sign in parallel). |
| **Signing experience** | No account needed. ESIGN-style consent disclosure → **Start** → guided **Next field** → **Finish**. Type (4 signature fonts), draw (smoothed, pressure-aware) or upload (background removed) a signature; initials adopted separately. Date-signed fields fill with the actual signing instant (stored UTC, shown in the workspace time zone and format). Full mobile support (input sheets, large touch targets). Decline with reason. |
| **Completion** | When the last signer finishes: fields are written into the original pages → page count verified unchanged → PDF digitally sealed (PKCS#7, tamper-evident) → separate **audit trail PDF** → workflow locked → signed copy emailed to every party (attachment, or secure link only) → available in the dashboard. |
| **Removed** | The extra "Certificate of Completion" page and the footer stamp on every page (old `buildCompletedPdf`). |
| **Dashboard** | Overview, All, Drafts, Waiting for me, Waiting for others, Completed, Declined, Expired, Templates, Contacts, Settings. Search, status filter, sorting, progress, last activity. Actions: sign now, resend, cancel, download signed PDF / audit trail / original, save as template, delete. |
| **Templates** | Save any prepared document (PDF + roles + every field) as a template, or build one from an upload in the same editor. Using it only needs names and emails. |
| **Audit & integrity** | Append-only, HMAC-SHA256 hash-chained event log (created, sent, invited, viewed, consent, signed, declined, completed, sealed…) with IP and user agent. Verified on the document page. SHA-256 of original and signed files. |
| **White-label** | Per workspace: company name, product name (e.g. "TRAVIS BAIL.SIGN"), accent colour, logo, email sender name, time zone, date format. Emails and signing pages use them. Every document, template, contact, API key and webhook is scoped to its workspace. |
| **CRM API** | `/api/v1` with workspace API keys (only SHA-256 stored): create from PDF or template, send, void, status, look up by `externalRef`, download signed PDF / audit trail. Signed webhooks with retries. Reference in **Settings → API & webhooks**. |
| **Security** | Documents, signature images and finished files encrypted at rest (AES-256-GCM). Expiring, revocable HMAC signing links. Signers can only touch their own fields. Roles (owner / admin / member). CSRF origin checks, rate limits, PDF validation (type, size, encryption, page limit), pdf.js with script evaluation off, retention policy. |
| **Design** | New design system: Geist type, warm neutrals, TRACE vermilion accent, light and dark themes (follows the OS, switchable in the account menu), responsive down to phones. |

Your existing Email Integration, delivery log, IMAP inbox, bounce handling, retries and DNS checks are unchanged and restyled.

---

## Upgrading an existing install

Your data is kept. Migration `0001_v2_editor` only **adds** tables and columns.

```bash
npm install          # new packages: lucide-react, Geist fonts, (dev) playwright-core
npm run db:migrate   # applies 0001_v2_editor
npm run build && npm start
```

On Windows, `START-TRACE-SIGN.bat` does all of this. Documents sent with 1.x still work: their signers adopt a signature and the signed PDF keeps the original pages.

## Fresh install

```bash
npm install
cp .env.example .env
npm run gen:key        # → SETTINGS_ENCRYPTION_KEY  (back it up: it also decrypts stored documents)
npm run gen:key        # → SESSION_SECRET
npm run gen:key        # → CRON_SECRET
npm run hash-password  # → ADMIN_PASSWORD_HASH
npm run db:migrate
npm run build && npm start
```

Sign in at `/login`, then:
1. **Email delivery**: connect the mailbox (Hostinger preset → Save → Test connection → Send test email → Verify alias). DNS records are listed on that page.
2. **Settings → Workspace & branding**: name, colour, logo, time zone, date format.
3. **Settings → Security & delivery**: sealing certificate, attachment vs link delivery, audit attachment, retention.
4. Run the scheduler (reminders, expiry, retries, webhooks, retention, IMAP): `npm run worker` next to `npm start`, or `/api/cron/tick` with `Authorization: Bearer $CRON_SECRET` (see `vercel.json`).

> **Back up `SETTINGS_ENCRYPTION_KEY`.** It encrypts mailbox passwords *and* stored PDFs and signatures. Without it, stored documents can't be read.

## Local testing without a real mailbox

```bash
npm run mail:dev                                   # SMTP :2525 / IMAP :1143, dev@trace-studio.tech / dev-password
DATABASE_URL=pglite:./.data/pg npm run db:migrate
DATABASE_URL=pglite:./.data/pg APP_URL=http://localhost:3000 npm run dev
```
Every email is saved to `.data/dev-mail/*.html` so you can open it.

## Tests

| Command | Covers |
|---|---|
| `npm run test:workflow` | 80 checks on the real pipeline (PGlite + SMTP + pdf.js verification): Scenario A (5 pages, page-5 fields, sequential, both sign → exactly 5 pages, fields inside their boxes, sealed, emails), B (rotated/cropped/mixed pages), D (required fields, premature finalization), E (cross-recipient access, forged tokens, edits after send), templates, decline, webhooks, workspace isolation, retention. |
| `npm run test:e2e` | 45 mailbox checks (encryption at rest, alias, retries, duplicates, IMAP read-only, bounces…). |
| `npm run test:browser` | 56 checks in Chromium against a running server: drag-and-drop editing, resize, cross-page move, zoom accuracy, keyboard, undo, preview, validation, sender signs (drawn), client signs on an emulated iPhone (typed), completed PDF content, emails, templates UI, CRM API, rate limiting, no page errors. Needs `npm run mail:dev` and a running app. |

## CRM API in 30 seconds

```bash
curl -X POST https://sign.trace-studio.tech/api/v1/documents \
  -H "Authorization: Bearer tsk_…" \
  -F file=@agreement.pdf \
  -F 'data={"title":"Bail Agreement","send":true,"signingOrder":"sequential","externalRef":"case-1042",
            "recipients":[{"key":"agent","name":"Travis","email":"travis@agency.com","order":1},
                          {"key":"client","name":"Michael","email":"michael@mail.com","order":2}],
            "fields":[{"recipient":"agent","type":"signature","page":5,"x":72,"y":600},
                      {"recipient":"client","type":"signature","page":5,"x":330,"y":600},
                      {"recipient":"client","type":"date","page":5,"x":330,"y":660}]}'
```
Coordinates are PDF points from the top-left of the page (1-based page numbers); add `"unit":"fraction"` to use 0–1 values. Webhooks are signed: `X-TraceSign-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.

## Legal notes (read before relying on it)

- What TRACE.SIGN records lines up with what the U.S. **ESIGN Act** and **UETA** look for: a consumer disclosure and consent step, intent (explicit adopt and finish actions), attribution (a personal link to the signer's email, IP and user agent), and a retained, tamper-evident record. Whether a given document type can be signed electronically depends on the law. Some documents are excluded (e.g. wills, certain court and family-law documents, some notices). Have counsel confirm for your clients' states and use cases.
- The PDF **seal** proves integrity, meaning the file wasn't changed after completion. With the default self-signed certificate, readers show the identity as untrusted until you install an AATL document-signing certificate (**Settings → Security**).
- Signatures here are **simple electronic signatures** under **eIDAS**. They are *not* advanced or qualified electronic signatures, which need qualified certificates and verified signer identity. Don't present them as such.
- Signer identity is email-based. For higher-risk documents, add an identity step (SMS code, ID check). That's a planned extension point, not built yet.

## Project layout

```
src/lib/documents.ts        workflow: drafts, send, routing, signing, completion, scheduler jobs
src/lib/templates.ts        templates
src/lib/pdf.ts              upload validation, field writer (no page changes), audit-trail PDF
src/lib/geometry.ts         shared coordinate model (editor, signer, PDF writer)
src/lib/seal.ts             PKCS#7 seal + certificates
src/lib/audit.ts            hash-chained audit log
src/lib/webhooks.ts         outgoing webhooks
src/lib/org.ts              workspaces / white-label
src/lib/v1.ts, api.ts       integration API helpers, auth wrappers, rate limits
src/components/editor/      document preparation editor
src/components/signing/     signing room, signature adoption (type / draw / upload)
src/components/pdf/         pdf.js loader and page renderer
src/app/admin/…             dashboard, documents, templates, contacts, settings, email
src/app/sign/[token]/       public signing page
src/app/api/v1/…            CRM API
drizzle/0001_v2_editor.sql  v2 migration
```

## Known limits

- Rate limits are per server process (fine for one instance). Use a shared store such as Redis if you run several.
- Delivery from a plain SMTP mailbox can only be confirmed as *accepted*. Bounces arrive later over IMAP. Mailbox plans cap daily sends.
- One sending mailbox per deployment. Workspaces brand the display name, not the address.
- Fillable AcroForm fields already in a PDF are shown but not converted into TRACE.SIGN fields. Place fields over them.
- Text fields use the standard Helvetica font (Latin characters). Arabic or other scripts in text fields need an embedded Unicode font (fontkit is installed; not wired yet). Signatures, as images, work in any script.
