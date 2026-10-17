"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2, Upload, Webhook } from "lucide-react";
import { api, CopyButton, Empty, Pill, Spinner, Switch, When, useToast } from "@/components/ui";
import { DATE_FORMATS, formatDate } from "@/lib/geometry";
import { Mark } from "@/components/Logo";

interface Org {
  id: string;
  name: string;
  brandName: string;
  accentColor: string;
  emailFromName: string | null;
  timezone: string;
  dateFormat: string;
  completionDelivery: string;
  attachAuditToEmail: boolean;
  sealPdf: boolean;
  retentionDays: number;
  hasLogo: boolean;
}

function useSaver() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok = "Saved") => {
    setBusy(true);
    try {
      const r = await fn();
      toast(ok);
      router.refresh();
      return r;
    } catch (e) {
      toast((e as Error).message, "bad");
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function saveOrg(o: Org) {
  return api("/api/admin/settings/branding", {
    method: "PUT",
    json: { name: o.name, brandName: o.brandName, accentColor: o.accentColor, emailFromName: o.emailFromName, timezone: o.timezone, dateFormat: o.dateFormat, completionDelivery: o.completionDelivery, attachAuditToEmail: o.attachAuditToEmail, sealPdf: o.sealPdf, retentionDays: o.retentionDays },
  });
}

export function BrandingForm({ org: initial, disabled }: { org: Org; disabled: boolean }) {
  const [o, setO] = useState(initial);
  const { busy, run } = useSaver();
  const set = <K extends keyof Org>(k: K, v: Org[K]) => setO((x) => ({ ...x, [k]: v }));
  const [logoV, setLogoV] = useState(0);
  return (
    <div className="grid settings-grid">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => saveOrg(o));
        }}
      >
        <div>
          <h2>Workspace &amp; white-label branding</h2>
          <p className="small muted" style={{ marginTop: 3 }}>Recipients see this name, colour and logo on emails and the signing page, e.g. “TRAVIS BAIL.SIGN”.</p>
        </div>
        <div className="grid g2" style={{ alignItems: "end" }}>
          <label className="f">
            Company name
            <input value={o.name} onChange={(e) => set("name", e.target.value)} disabled={disabled} maxLength={120} />
          </label>
          <label className="f">
            Product name <span className="hint">Shown to signers</span>
            <input value={o.brandName} onChange={(e) => set("brandName", e.target.value)} disabled={disabled} maxLength={60} />
          </label>
        </div>
        <div className="grid g2" style={{ alignItems: "end" }}>
          <label className="f">
            Accent colour
            <span className="color-in">
              <input type="color" value={o.accentColor} onChange={(e) => set("accentColor", e.target.value.toUpperCase())} disabled={disabled} aria-label="Accent colour" />
              <input value={o.accentColor} onChange={(e) => set("accentColor", e.target.value)} disabled={disabled} maxLength={7} className="mono" />
            </span>
          </label>
          <label className="f">
            Email sender name <span className="hint">Defaults to the product name</span>
            <input value={o.emailFromName ?? ""} onChange={(e) => set("emailFromName", e.target.value || null)} disabled={disabled} maxLength={80} placeholder={o.brandName} />
          </label>
        </div>
        <div className="grid g2" style={{ alignItems: "end" }}>
          <label className="f">
            Time zone <span className="hint">IANA name, used for dates on documents</span>
            <input value={o.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={disabled} list="tz-list" />
            <datalist id="tz-list">
              {["America/Los_Angeles", "UTC", "America/Denver", "America/Chicago", "America/New_York", "America/Phoenix", "Europe/London", "Africa/Cairo", "Asia/Riyadh", "Asia/Dubai"].map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </label>
          <label className="f">
            Date format
            <select value={o.dateFormat} onChange={(e) => set("dateFormat", e.target.value)} disabled={disabled}>
              {DATE_FORMATS.map((d) => (
                <option key={d} value={d}>
                  {formatDate(new Date(), d)} ({d})
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <span className="spacer" />
          <button className="btn primary" disabled={busy || disabled}>
            {busy && <Spinner />} Save changes
          </button>
        </div>
      </form>

      <div className="stack">
        <div className="card stack">
          <h2>Logo</h2>
          <div className="row nowrap" style={{ gap: 14 }}>
            <div className="logo-prev">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {initial.hasLogo ? <img src={`/api/brand/logo?org=${initial.id}&v=${logoV}`} alt="Logo" /> : <Mark size={34} />}
            </div>
            <div className="stack tight" style={{ flex: 1 }}>
              <label className="btn sm" style={{ position: "relative", alignSelf: "flex-start" }}>
                <Upload size={13} /> Upload PNG
                <input
                  type="file"
                  accept="image/png"
                  disabled={disabled}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const fd = new FormData();
                    fd.append("file", f);
                    void run(() => api("/api/admin/settings/logo", { method: "POST", body: fd }), "Logo updated").then(() => setLogoV(Date.now()));
                  }}
                />
              </label>
              {initial.hasLogo && (
                <button className="linkish xs" style={{ alignSelf: "flex-start" }} disabled={disabled} onClick={() => void run(() => api("/api/admin/settings/logo", { method: "DELETE" }), "Logo removed")}>
                  Remove logo
                </button>
              )}
              <span className="xs muted">PNG, up to 512 KB. Square or wide, transparent background works best.</span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="xs muted" style={{ marginBottom: 10 }}>Email preview</div>
          <div style={{ background: "#f5f5f4", borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 700, letterSpacing: ".14em", fontSize: 12, color: "#18181b", marginBottom: 10 }}>{o.brandName}</div>
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e4e4e7", padding: 16 }}>
              <div style={{ height: 3, width: 32, background: o.accentColor, borderRadius: 2, marginBottom: 12 }} />
              <div style={{ fontWeight: 700, color: "#18181b", fontSize: 15 }}>{o.name} sent you a document to sign</div>
              <div style={{ color: "#52525b", fontSize: 12.5, margin: "8px 0 14px" }}>Please review and sign “Bail Agreement”.</div>
              <span style={{ display: "inline-block", background: o.accentColor, color: "#fff", borderRadius: 7, padding: "9px 14px", fontSize: 12.5, fontWeight: 600 }}>Review and sign</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SecurityPanel({ org: initial, cert, disabled }: { org: Org; cert: { subject: string; issuer: string; notAfter: string; selfSigned: boolean; fingerprint: string } | null; disabled: boolean }) {
  const [o, setO] = useState(initial);
  const { busy, run } = useSaver();
  const [pass, setPass] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const set = <K extends keyof Org>(k: K, v: Org[K]) => setO((x) => ({ ...x, [k]: v }));
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row nowrap" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <h2>Completed documents</h2>
            <p className="small muted" style={{ marginTop: 3 }}>How finished PDFs are protected and delivered to every party.</p>
          </div>
        </div>
        <div className="row nowrap" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="small strong">Digitally seal signed PDFs</div>
            <div className="xs muted">Applies a PKCS#7 signature so any later change to the file is detectable in Acrobat and other readers.</div>
          </div>
          <Switch checked={o.sealPdf} onChange={(v) => set("sealPdf", v)} label="Seal PDFs" />
        </div>
        <label className="f">
          Deliver the signed copy
          <select value={o.completionDelivery} onChange={(e) => set("completionDelivery", e.target.value)} disabled={disabled}>
            <option value="attachment">Attach the PDF to the completion email (plus a secure link)</option>
            <option value="link">Secure, expiring download link only (no attachment)</option>
          </select>
        </label>
        {o.completionDelivery === "attachment" && (
          <label className="check">
            <input type="checkbox" checked={o.attachAuditToEmail} onChange={(e) => set("attachAuditToEmail", e.target.checked)} disabled={disabled} />
            <span>
              Attach the audit trail as a separate PDF
              <small>The audit trail is never added to the signed document itself.</small>
            </span>
          </label>
        )}
        <label className="f">
          Data retention <span className="hint">Finished documents (completed, declined, expired, cancelled) are deleted after this many days. 0 keeps them forever.</span>
          <input type="number" min={0} max={3650} value={o.retentionDays} onChange={(e) => set("retentionDays", Number(e.target.value))} disabled={disabled} style={{ maxWidth: 160 }} />
        </label>
        <div className="row">
          <span className="spacer" />
          <button className="btn primary" disabled={busy || disabled} onClick={() => void run(() => saveOrg(o))}>
            {busy && <Spinner />} Save
          </button>
        </div>
      </div>

      {cert && (
        <div className="card stack">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={16} /> Sealing certificate
            </h2>
            <p className="small muted" style={{ marginTop: 3 }}>
              {cert.selfSigned
                ? "Your workspace has its own self-signed certificate. Readers will show the seal as valid but the identity as “not trusted” until it's added to their trust list. For automatic trust, upload a document-signing certificate from a CA on the Adobe Approved Trust List (AATL)."
                : "Signed PDFs are sealed with your uploaded certificate."}
            </p>
          </div>
          <dl className="kv">
            <dt>Subject</dt>
            <dd>{cert.subject}</dd>
            <dt>Issuer</dt>
            <dd>{cert.issuer}</dd>
            <dt>Valid until</dt>
            <dd>
              <When at={cert.notAfter} mode="date" />
            </dd>
            <dt>SHA-256</dt>
            <dd className="mono" style={{ fontSize: 10.5, wordBreak: "break-all" }}>{cert.fingerprint}</dd>
          </dl>
          <div className="grid g3" style={{ alignItems: "end" }}>
            <label className="f">
              Certificate (.p12 / .pfx)
              <input type="file" accept=".p12,.pfx,application/x-pkcs12" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={disabled} />
            </label>
            <label className="f">
              Passphrase
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} disabled={disabled} autoComplete="off" />
            </label>
            <div className="row">
              <button
                className="btn"
                disabled={!file || busy || disabled}
                onClick={() => {
                  const fd = new FormData();
                  fd.append("file", file!);
                  fd.append("passphrase", pass);
                  void run(() => api("/api/admin/settings/seal", { method: "POST", body: fd }), "Certificate installed");
                }}
              >
                <Upload size={14} /> Install
              </button>
              {!cert.selfSigned && (
                <button className="btn ghost" disabled={busy || disabled} onClick={() => window.confirm("Remove the uploaded certificate and go back to a self-signed seal?") && void run(() => api("/api/admin/settings/seal", { method: "DELETE" }), "Certificate removed")}>
                  Use self-signed
                </button>
              )}
            </div>
          </div>
          <div className="note" style={{ fontSize: 12.5 }}>
            <strong>About legal effect</strong>
            Signatures collected here are electronic signatures with consent, intent, attribution and a tamper-evident audit trail, the elements the U.S. ESIGN Act and UETA look for. The seal protects the file&apos;s integrity. It does not make signatures “qualified” or “advanced” electronic signatures under eIDAS. Those require qualified certificates and signer identity verification.
          </div>
        </div>
      )}
    </div>
  );
}

interface Key {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
interface Hook {
  id: string;
  url: string;
  events: string;
  active: boolean;
  createdAt: string;
}

export function DevelopersPanel({ keys, hooks, deliveries, events, baseUrl, disabled }: { keys: Key[]; hooks: Hook[]; deliveries: { id: string; event: string; url: string; status: string; attempts: number; code: number | null; error: string | null; at: string }[]; events: string[]; baseUrl: string; disabled: boolean }) {
  const { busy, run } = useSaver();
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <KeyRound size={16} /> API keys
          </h2>
          <p className="small muted" style={{ marginTop: 3 }}>Let your CRM create signature requests, read status and download signed PDFs. Keys only see this workspace.</p>
        </div>
        {newKey && (
          <div className="secret">
            <code>{newKey}</code>
            <CopyButton text={newKey} />
            <span className="xs" style={{ flexBasis: "100%" }}>Copy it now. For security it won&apos;t be shown again.</span>
          </div>
        )}
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = (await run(() => api<{ key: string }>("/api/admin/settings/api-keys", { json: { name: keyName } }), "API key created")) as { key: string } | null;
            if (r) {
              setNewKey(r.key);
              setKeyName("");
            }
          }}
        >
          <input placeholder="Key name, e.g. Trace Bail CRM" value={keyName} onChange={(e) => setKeyName(e.target.value)} style={{ maxWidth: 320 }} disabled={disabled} required />
          <button className="btn" disabled={busy || disabled || !keyName.trim()}>
            <Plus size={14} /> Create key
          </button>
        </form>
        {keys.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="small strong">{k.name}</td>
                  <td className="mono">{k.prefix}…</td>
                  <td className="small dim">
                    <When at={k.lastUsedAt} empty="Never" mode="relative" />
                  </td>
                  <td>{k.revokedAt ? <Pill status="neutral" label="Revoked" /> : <Pill status="ok" label="Active" />}</td>
                  <td style={{ textAlign: "right" }}>
                    {!k.revokedAt && (
                      <button className="btn danger sm" disabled={disabled} onClick={() => window.confirm(`Revoke “${k.name}”? Integrations using it stop working immediately.`) && void run(() => api(`/api/admin/settings/api-keys/${k.id}`, { method: "DELETE" }), "Key revoked")}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card stack">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Webhook size={16} /> Webhooks
          </h2>
          <p className="small muted" style={{ marginTop: 3 }}>
            We POST JSON to your URL when things happen, signed with <code>X-TraceSign-Signature: t=…,v1=HMAC-SHA256(secret, &quot;t.body&quot;)</code>. Failed deliveries are retried with backoff.
          </p>
        </div>
        {newSecret && (
          <div className="secret">
            <code>{newSecret}</code>
            <CopyButton text={newSecret} />
            <span className="xs" style={{ flexBasis: "100%" }}>Signing secret: store it in your CRM to verify requests. It won&apos;t be shown again.</span>
          </div>
        )}
        <form
          className="stack tight"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = (await run(() => api<{ secret: string }>("/api/admin/settings/webhooks", { json: { url, events: sel } }), "Webhook added")) as { secret: string } | null;
            if (r) {
              setNewSecret(r.secret);
              setUrl("");
              setSel([]);
            }
          }}
        >
          <div className="row">
            <input type="url" placeholder="https://crm.example.com/webhooks/trace-sign" value={url} onChange={(e) => setUrl(e.target.value)} style={{ maxWidth: 460 }} disabled={disabled} required />
            <button className="btn" disabled={busy || disabled || !url}>
              <Plus size={14} /> Add endpoint
            </button>
          </div>
          <div className="chips">
            {events.map((ev) => (
              <button type="button" key={ev} className={`chip ${sel.includes(ev) ? "on" : ""}`} onClick={() => setSel((s) => (s.includes(ev) ? s.filter((x) => x !== ev) : [...s, ev]))}>
                {ev}
              </button>
            ))}
          </div>
          <span className="xs muted">{sel.length ? `${sel.length} event(s) selected` : "No selection = all events"}</span>
        </form>
        {hooks.length > 0 && (
          <table className="tbl">
            <tbody>
              {hooks.map((h) => (
                <tr key={h.id}>
                  <td className="mono" style={{ wordBreak: "break-all" }}>{h.url}</td>
                  <td className="xs dim">{h.events === "*" ? "All events" : h.events.split(",").join(", ")}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn ghost icon sm" aria-label="Delete webhook" disabled={disabled} onClick={() => window.confirm("Delete this webhook endpoint?") && void run(() => api(`/api/admin/settings/webhooks/${h.id}`, { method: "DELETE" }), "Webhook deleted")}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {deliveries.length > 0 && (
          <>
            <div className="small strong">Recent deliveries</div>
            <table className="tbl">
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.event}</td>
                    <td>
                      <Pill status={d.status} />
                    </td>
                    <td className="xs dim">{d.code ? `HTTP ${d.code}` : d.error ?? ""}</td>
                    <td className="xs dim">{d.attempts} attempt(s)</td>
                    <td className="xs dim">
                      <When at={d.at} mode="relative" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card stack">
        <h2>API quick reference</h2>
        <p className="small muted">All requests use <code>Authorization: Bearer tsk_…</code>. Coordinates use points from the top-left of each page (1-based page numbers), or <code>&quot;unit&quot;: &quot;fraction&quot;</code> for 0–1 values.</p>
        <pre className="code-block">{`# Create and send a document
curl -X POST ${baseUrl}/api/v1/documents \\
  -H "Authorization: Bearer $TRACE_SIGN_KEY" \\
  -F file=@agreement.pdf \\
  -F 'data={
    "title": "Bail Agreement",
    "signingOrder": "sequential",
    "externalRef": "case-1042",
    "send": true,
    "recipients": [
      { "key": "agent",  "name": "Travis",  "email": "travis@agency.com", "order": 1 },
      { "key": "client", "name": "Michael", "email": "michael@mail.com",  "order": 2 }
    ],
    "fields": [
      { "recipient": "agent",  "type": "signature", "page": 5, "x": 72,  "y": 600 },
      { "recipient": "agent",  "type": "date",      "page": 5, "x": 72,  "y": 660 },
      { "recipient": "client", "type": "signature", "page": 5, "x": 330, "y": 600 },
      { "recipient": "client", "type": "name",      "page": 5, "x": 330, "y": 660 }
    ]
  }'

# From a template (role keys from GET /api/v1/templates)
POST ${baseUrl}/api/v1/templates/{id}/documents
  { "recipients": { "<roleKey>": { "name": "…", "email": "…" } }, "send": true }

GET  ${baseUrl}/api/v1/documents?externalRef=case-1042
GET  ${baseUrl}/api/v1/documents/{id}                 # status, recipients, fields
POST ${baseUrl}/api/v1/documents/{id}/send
POST ${baseUrl}/api/v1/documents/{id}/void
GET  ${baseUrl}/api/v1/documents/{id}/pdf?which=completed|audit|original`}</pre>
      </div>
    </div>
  );
}

export function TeamPanel({ members, me, owner, disabled }: { members: { id: string; email: string; name: string; role: string; lastLoginAt: string | null; disabled: boolean }[]; me: string; owner: string | null; disabled: boolean }) {
  const { busy, run } = useSaver();
  const [f, setF] = useState({ name: "", email: "", role: "member", password: "" });
  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <h2>Team members</h2>
          <p className="small muted" style={{ marginTop: 3 }}>Admins manage settings, keys and the team. Members prepare, send and track documents.</p>
        </div>
        <table className="tbl">
          <tbody>
            {owner && (
              <tr>
                <td>
                  <div className="small strong">Owner</div>
                  <div className="xs muted">{owner}</div>
                </td>
                <td>
                  <Pill status="accent" label="Owner" />
                </td>
                <td className="xs muted">Set in the server environment</td>
                <td />
              </tr>
            )}
            {members.map((m) => (
              <tr key={m.id} style={{ opacity: m.disabled ? 0.5 : 1 }}>
                <td>
                  <div className="small strong">{m.name}</div>
                  <div className="xs muted">{m.email}</div>
                </td>
                <td>
                  <Pill status={m.disabled ? "neutral" : m.role === "admin" ? "info" : "neutral"} label={m.disabled ? "Removed" : m.role === "admin" ? "Admin" : "Member"} />
                </td>
                <td className="xs dim">
                  Last sign-in <When at={m.lastLoginAt} empty="never" mode="relative" />
                </td>
                <td style={{ textAlign: "right" }}>
                  {!m.disabled && m.id !== me && (
                    <button className="btn danger sm" disabled={disabled} onClick={() => window.confirm(`Remove ${m.email}? They'll be signed out. Their documents stay.`) && void run(() => api(`/api/admin/settings/users/${m.id}`, { method: "DELETE" }), "Removed")}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!members.length && !owner && <Empty title="No members yet" />}
      </div>
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api("/api/admin/settings/users", { json: f }), "Member added")) setF({ name: "", email: "", role: "member", password: "" });
        }}
      >
        <h2>Add a member</h2>
        <div className="grid g2" style={{ alignItems: "end" }}>
          <label className="f">
            Name
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required disabled={disabled} />
          </label>
          <label className="f">
            Email
            <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required disabled={disabled} />
          </label>
          <label className="f">
            Role
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} disabled={disabled}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="f">
            Temporary password <span className="hint">At least 12 characters. Share it securely.</span>
            <input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={12} required disabled={disabled} autoComplete="off" />
          </label>
        </div>
        <div className="row">
          <span className="spacer" />
          <button className="btn primary" disabled={busy || disabled}>
            {busy && <Spinner />} Add member
          </button>
        </div>
      </form>
    </div>
  );
}
