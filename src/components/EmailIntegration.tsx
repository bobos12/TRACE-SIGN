"use client";
import { useMemo, useState } from "react";
import { PRESETS, type SmtpSecurity } from "@/lib/presets";
import { recordsFor } from "@/lib/dns-guide";
import { api, Pill, When } from "./ui";

export interface SettingsView {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecurity: string;
  smtpUser: string | null;
  hasSmtpPassword: boolean;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  aliasStatus: string;
  aliasDetail: string | null;
  lastSmtpTestAt: string | null;
  lastSmtpTestOk: boolean | null;
  lastSmtpError: string | null;
  imapEnabled: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean;
  imapUseSmtpLogin: boolean;
  imapUser: string | null;
  hasImapPassword: boolean;
  imapMailbox: string;
  imapReadOnly: boolean;
  imapLastSyncAt: string | null;
  imapLastError: string | null;
  imapInitialLookbackDays: number;
  adminNotifyEmail: string | null;
  notifyOnOpen: boolean;
  notifyOnDecline: boolean;
  notifyOnComplete: boolean;
  notifyOnExpire: boolean;
}

type Result = { ok: boolean; message: string; code?: string; messageId?: string } | null;

function toForm(s: SettingsView) {
  return {
    smtpHost: s.smtpHost ?? "",
    smtpPort: s.smtpPort ?? 465,
    smtpSecurity: (s.smtpSecurity as SmtpSecurity) ?? "ssl",
    smtpUser: s.smtpUser ?? "",
    smtpPassword: "",
    clearSmtpPassword: false,
    fromEmail: s.fromEmail,
    fromName: s.fromName,
    replyTo: s.replyTo ?? "",
    imapEnabled: s.imapEnabled,
    imapHost: s.imapHost ?? "",
    imapPort: s.imapPort ?? 993,
    imapSecure: s.imapSecure,
    imapUseSmtpLogin: s.imapUseSmtpLogin,
    imapUser: s.imapUser ?? "",
    imapPassword: "",
    clearImapPassword: false,
    imapMailbox: s.imapMailbox,
    imapReadOnly: s.imapReadOnly,
    imapInitialLookbackDays: s.imapInitialLookbackDays,
    adminNotifyEmail: s.adminNotifyEmail ?? "",
    notifyOnOpen: s.notifyOnOpen,
    notifyOnDecline: s.notifyOnDecline,
    notifyOnComplete: s.notifyOnComplete,
    notifyOnExpire: s.notifyOnExpire,
  };
}
type Form = ReturnType<typeof toForm>;

function providerOf(host: string): string {
  const p = PRESETS.find((x) => x.smtpHost && x.smtpHost === host.trim().toLowerCase());
  return p?.id ?? "custom";
}

function ResultNote({ r }: { r: Result }) {
  if (!r) return null;
  return (
    <div className={`note ${r.ok ? "ok" : "bad"}`} role="status">
      <strong>{r.ok ? "Success" : r.code === "ALIAS_REJECTED" ? "Alias not authorized for sending" : r.code === "AUTH_FAILED" ? "Login rejected" : "Failed"}</strong>
      {r.message}
    </div>
  );
}

export function EmailIntegration({ initial }: { initial: SettingsView }) {
  const [saved, setSaved] = useState(initial);
  const [f, setF] = useState<Form>(() => {
    const base = toForm(initial);
    if (initial.smtpHost) return base;
    const h = PRESETS[0]; // Hostinger by default on first setup
    return { ...base, smtpHost: h.smtpHost, smtpPort: h.smtpPort, smtpSecurity: h.smtpSecurity, imapHost: h.imapHost, imapPort: h.imapPort };
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<Result>(null);
  const [smtpRes, setSmtpRes] = useState<Result>(null);
  const [testTo, setTestTo] = useState(initial.fromEmail);
  const [lastTestId, setLastTestId] = useState<string | null>(null);
  const [aliasRes, setAliasRes] = useState<Result>(null);
  const [imapRes, setImapRes] = useState<Result>(null);
  const [dns, setDns] = useState<null | { domain: string; checks: { name: string; status: string; found: string[]; advice: string }[] }>(null);
  const [showPw, setShowPw] = useState(false);
  const [preset, setPreset] = useState(() => (initial.smtpHost ? providerOf(initial.smtpHost) : "hostinger"));

  const dirty = useMemo(() => JSON.stringify(toForm(saved)) !== JSON.stringify(f), [saved, f]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const domain = f.fromEmail.split("@")[1] || "trace-studio.tech";
  const presetInfo = PRESETS.find((p) => p.id === preset);

  function applyPreset(id: string) {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p || id === "custom") return;
    setF((x) => ({ ...x, smtpHost: p.smtpHost, smtpPort: p.smtpPort, smtpSecurity: p.smtpSecurity, imapHost: p.imapHost, imapPort: p.imapPort, imapSecure: true }));
  }

  function setSecurity(sec: SmtpSecurity) {
    setF((x) => ({ ...x, smtpSecurity: sec, smtpPort: sec === "ssl" && x.smtpPort === 587 ? 465 : sec === "starttls" && x.smtpPort === 465 ? 587 : x.smtpPort }));
  }

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      return await fn();
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    await run("save", async () => {
      try {
        const s = await api<SettingsView>("/api/admin/email/settings", { method: "PUT", json: f });
        setSaved(s);
        setF(toForm(s));
        setSaveMsg({ ok: true, message: "Settings saved. Credentials are encrypted at rest." });
      } catch (e) {
        setSaveMsg({ ok: false, message: (e as Error).message });
      }
    });
  }

  async function refresh() {
    const s = await api<SettingsView>("/api/admin/email/settings");
    setSaved(s);
  }

  const smtpReady = !!(saved.smtpHost && saved.smtpUser && saved.hasSmtpPassword);
  const aliasTone = saved.aliasStatus === "ok" ? "ok" : saved.aliasStatus === "unknown" ? "unknown" : "rejected";

  return (
    <div className="stack">
      {/* ── Status overview ───────────────────────────── */}
      <div className="grid g3">
        <div className="card stat">
          <div className="stat-l">Outgoing (SMTP)</div>
          <div className="row" style={{ marginTop: 8 }}>
            {!smtpReady ? <Pill status="pending" label="not configured" /> : saved.lastSmtpTestOk === null ? <Pill status="unknown" label="not tested" /> : saved.lastSmtpTestOk ? <Pill status="ok" label="connected" /> : <Pill status="failed" label="error" />}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Last test: <When at={saved.lastSmtpTestAt} empty="never" /></div>
        </div>
        <div className="card stat">
          <div className="stat-l">Sender alias</div>
          <div className="row" style={{ marginTop: 8 }}>
            <Pill status={aliasTone} label={saved.aliasStatus === "ok" ? "authorized" : saved.aliasStatus === "unknown" ? "unverified" : saved.aliasStatus} />
            <span className="small mono">{saved.fromEmail}</span>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>{saved.aliasDetail ?? "Send a test email to verify."}</div>
        </div>
        <div className="card stat">
          <div className="stat-l">Incoming (IMAP)</div>
          <div className="row" style={{ marginTop: 8 }}>
            {!saved.imapEnabled ? <Pill status="neutral" label="off" /> : saved.imapLastError ? <Pill status="failed" label="error" /> : saved.imapLastSyncAt ? <Pill status="ok" label="syncing" /> : <Pill status="unknown" label="not synced" />}
            {saved.imapEnabled && saved.imapReadOnly && <span className="small muted">read-only</span>}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Last sync: <When at={saved.imapLastSyncAt} empty="never" /></div>
        </div>
      </div>

      {saved.lastSmtpError && (
        <div className="note bad">
          <strong>Sending is paused or failing</strong>
          {saved.lastSmtpError}
        </div>
      )}

      {/* ── SMTP ──────────────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>1 · SMTP connection</h2>
            <p>Your company mailbox sends every TRACE.SIGN email. No third-party email service is involved.</p>
          </div>
        </div>
        <div className="stack">
          <label className="f" style={{ maxWidth: 360 }}>
            Email provider
            <select value={preset} onChange={(e) => applyPreset(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {presetInfo?.note && <div className="note small">{presetInfo.note}</div>}

          <div className="grid g3">
            <label className="f" style={{ gridColumn: "span 2" }}>
              SMTP server hostname
              <input type="text" value={f.smtpHost} placeholder="smtp.hostinger.com" onChange={(e) => set("smtpHost", e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <label className="f">
              SMTP port
              <input type="number" value={f.smtpPort} min={1} max={65535} onChange={(e) => set("smtpPort", Number(e.target.value))} />
            </label>
          </div>

          <div className="f" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
            Encryption
            <div className="seg" role="radiogroup">
              {(
                [
                  ["ssl", "SSL/TLS · 465"],
                  ["starttls", "STARTTLS · 587"],
                  ["none", "None"],
                ] as [SmtpSecurity, string][]
              ).map(([v, l]) => (
                <button type="button" key={v} className={f.smtpSecurity === v ? "on" : ""} onClick={() => setSecurity(v)} role="radio" aria-checked={f.smtpSecurity === v}>
                  {l}
                </button>
              ))}
            </div>
            {f.smtpSecurity === "none" && <span className="hint" style={{ color: "var(--bad)", fontWeight: 400 }}>Unencrypted: your password would cross the network in clear text. Use only for local testing.</span>}
          </div>

          <div className="grid g2">
            <label className="f">
              SMTP username
              <span className="hint">The parent mailbox that owns the alias, e.g. info@{domain}. Aliases usually have no login of their own.</span>
              <input type="text" value={f.smtpUser} placeholder={`mailbox@${domain}`} onChange={(e) => set("smtpUser", e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <label className="f">
              SMTP password or app password
              <span className="hint">{saved.hasSmtpPassword ? "A password is saved (encrypted). Leave blank to keep it." : "Stored encrypted with AES-256-GCM. Never shown again."}</span>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input
                  type={showPw ? "text" : "password"}
                  value={f.smtpPassword}
                  placeholder={saved.hasSmtpPassword ? "•••••••• (saved)" : ""}
                  onChange={(e) => set("smtpPassword", e.target.value)}
                  autoComplete="new-password"
                />
                <button type="button" className="btn ghost sm" onClick={() => setShowPw((v) => !v)}>
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* ── Identity ──────────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>2 · Sender identity</h2>
            <p>All signature emails go out as this address.</p>
          </div>
        </div>
        <div className="grid g3">
          <label className="f">
            Sender email
            <input type="email" value={f.fromEmail} onChange={(e) => set("fromEmail", e.target.value)} spellCheck={false} />
          </label>
          <label className="f">
            Sender display name
            <input type="text" value={f.fromName} onChange={(e) => set("fromName", e.target.value)} />
          </label>
          <label className="f">
            Reply-to address
            <span className="hint">Optional. Defaults to the sender.</span>
            <input type="email" value={f.replyTo} placeholder={f.fromEmail} onChange={(e) => set("replyTo", e.target.value)} spellCheck={false} />
          </label>
        </div>
        <div className="note small" style={{ marginTop: 16 }}>
          <strong>Alias sending</strong>
          TRACE.SIGN logs in as <span className="mono">{f.smtpUser || "the parent mailbox"}</span> and sends with <span className="mono">{f.fromEmail}</span> as both the From header and the envelope sender. Your provider decides whether that mailbox may use the alias: if it refuses, the test below reports
          a clear “alias not authorized” error and queued emails wait rather than going out under the wrong address.
        </div>
        {f.fromEmail !== "trace.sign@trace-studio.tech" && <div className="note warn small" style={{ marginTop: 10 }}>The official TRACE.SIGN sender is trace.sign@trace-studio.tech.</div>}
      </section>

      {/* ── Save + test ───────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>3 · Save and test</h2>
            <p>Tests always use the saved configuration.</p>
          </div>
          <button className="btn primary" onClick={save} disabled={busy !== null || !dirty}>
            {busy === "save" ? "Saving…" : dirty ? "Save settings" : "Saved"}
          </button>
        </div>
        <div className="stack">
          <ResultNote r={saveMsg} />
          {dirty && <div className="note warn small">You have unsaved changes. Save before testing.</div>}
          <div className="row">
            <button
              className="btn"
              disabled={busy !== null || dirty || !smtpReady}
              onClick={() =>
                run("conn", async () => {
                  setSmtpRes(null);
                  try {
                    setSmtpRes(await api("/api/admin/email/test-connection", { json: {} }));
                  } catch (e) {
                    setSmtpRes({ ok: false, message: (e as Error).message });
                  }
                  await refresh();
                })
              }
            >
              {busy === "conn" ? "Connecting…" : "Test connection"}
            </button>
            <span className="spacer" />
            <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ maxWidth: 280 }} aria-label="Send test email to" />
            <button
              className="btn"
              disabled={busy !== null || dirty || !smtpReady || !testTo}
              onClick={() =>
                run("send", async () => {
                  setSmtpRes(null);
                  try {
                    const r = await api<NonNullable<Result>>("/api/admin/email/send-test", { json: { to: testTo } });
                    setSmtpRes(r);
                    if (r.ok && r.messageId) setLastTestId(r.messageId);
                  } catch (e) {
                    setSmtpRes({ ok: false, message: (e as Error).message });
                  }
                  await refresh();
                })
              }
            >
              {busy === "send" ? "Sending…" : "Send test email"}
            </button>
          </div>
          {!smtpReady && <p className="small muted" style={{ margin: 0 }}>Enter the hostname, username and password, then save, to enable testing.</p>}
          <ResultNote r={smtpRes} />
          {lastTestId && saved.imapEnabled && (
            <div className="row">
              <button
                className="btn ghost"
                disabled={busy !== null}
                onClick={() =>
                  run("alias", async () => {
                    try {
                      setAliasRes(await api("/api/admin/email/verify-alias", { json: { messageId: lastTestId } }));
                    } catch (e) {
                      setAliasRes({ ok: false, message: (e as Error).message });
                    }
                    await refresh();
                  })
                }
              >
                {busy === "alias" ? "Checking mailbox…" : "Verify alias in delivered test"}
              </button>
              <span className="small muted">Reads the test from your mailbox over IMAP and checks the From line your provider actually delivered.</span>
            </div>
          )}
          <ResultNote r={aliasRes} />
        </div>
      </section>

      {/* ── IMAP ──────────────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>4 · Incoming mailbox (optional)</h2>
            <p>Reads replies and bounces for signature emails from the mailbox the alias delivers to.</p>
          </div>
          <label className="check">
            <input type="checkbox" checked={f.imapEnabled} onChange={(e) => set("imapEnabled", e.target.checked)} />
            <span>Enable IMAP</span>
          </label>
        </div>
        {f.imapEnabled ? (
          <div className="stack">
            <div className="grid g3">
              <label className="f" style={{ gridColumn: "span 2" }}>
                IMAP server hostname
                <input type="text" value={f.imapHost} placeholder="imap.hostinger.com" onChange={(e) => set("imapHost", e.target.value)} spellCheck={false} />
              </label>
              <label className="f">
                IMAP port
                <input type="number" value={f.imapPort} onChange={(e) => set("imapPort", Number(e.target.value))} />
              </label>
            </div>
            <div className="grid g2">
              <label className="check">
                <input type="checkbox" checked={f.imapSecure} onChange={(e) => set("imapSecure", e.target.checked)} />
                <span>
                  SSL/TLS
                  <small>Port 993. Recommended.</small>
                </span>
              </label>
              <label className="check">
                <input type="checkbox" checked={f.imapUseSmtpLogin} onChange={(e) => set("imapUseSmtpLogin", e.target.checked)} />
                <span>
                  Use the SMTP login
                  <small>The alias delivers into the parent mailbox, so the same account usually reads it.</small>
                </span>
              </label>
            </div>
            {!f.imapUseSmtpLogin && (
              <div className="grid g2">
                <label className="f">
                  IMAP username
                  <input type="text" value={f.imapUser} onChange={(e) => set("imapUser", e.target.value)} autoComplete="off" />
                </label>
                <label className="f">
                  IMAP password
                  <span className="hint">{saved.hasImapPassword ? "Saved (encrypted). Leave blank to keep." : "Stored encrypted."}</span>
                  <input type="password" value={f.imapPassword} placeholder={saved.hasImapPassword ? "•••••••• (saved)" : ""} onChange={(e) => set("imapPassword", e.target.value)} autoComplete="new-password" />
                </label>
              </div>
            )}
            <div className="grid g3">
              <label className="f">
                Folder
                <input type="text" value={f.imapMailbox} onChange={(e) => set("imapMailbox", e.target.value)} />
              </label>
              <label className="f">
                First import looks back
                <span className="hint">Days of existing mail to scan on first sync.</span>
                <input type="number" min={0} max={365} value={f.imapInitialLookbackDays} onChange={(e) => set("imapInitialLookbackDays", Number(e.target.value))} />
              </label>
              <label className="check" style={{ alignSelf: "end" }}>
                <input type="checkbox" checked={f.imapReadOnly} onChange={(e) => set("imapReadOnly", e.target.checked)} />
                <span>
                  Read-only access
                  <small>Mailbox opened with EXAMINE; nothing is flagged, moved or deleted.</small>
                </span>
              </label>
            </div>
            {!f.imapReadOnly && <div className="note warn small">With read-only off, TRACE.SIGN adds a “$TraceSignImported” keyword to messages it imports. It still never marks as read, moves or deletes mail.</div>}
            <div className="note small">
              <strong>What gets imported</strong>
              Only messages sent to {f.fromEmail}, replies to a TRACE.SIGN email, and delivery-failure reports. All other mail in the parent mailbox is skipped. Each message is imported once (by Message-ID and UID) and its original source is kept.
            </div>
            <div className="row">
              <button
                className="btn"
                disabled={busy !== null || dirty}
                onClick={() =>
                  run("imap", async () => {
                    try {
                      setImapRes(await api("/api/admin/email/test-imap", { json: {} }));
                    } catch (e) {
                      setImapRes({ ok: false, message: (e as Error).message });
                    }
                    await refresh();
                  })
                }
              >
                {busy === "imap" ? "Connecting…" : "Test IMAP connection"}
              </button>
              <button
                className="btn ghost"
                disabled={busy !== null || dirty || !saved.imapEnabled}
                onClick={() =>
                  run("sync", async () => {
                    try {
                      const r = await api<{ ok: boolean; imported?: number; scanned?: number; bounces?: number; matched?: number; error?: string }>("/api/admin/email/sync-imap", { json: {} });
                      setImapRes(
                        r.ok
                          ? { ok: true, message: `Scanned ${r.scanned} new message(s); imported ${r.imported} (${r.matched} linked to documents, ${r.bounces} bounce(s)).` }
                          : { ok: false, message: r.error ?? "Sync failed" },
                      );
                    } catch (e) {
                      setImapRes({ ok: false, message: (e as Error).message });
                    }
                    await refresh();
                  })
                }
              >
                {busy === "sync" ? "Syncing…" : "Sync now"}
              </button>
            </div>
            <ResultNote r={imapRes} />
            {saved.imapLastError && !imapRes && <div className="note bad small">{saved.imapLastError}</div>}
          </div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>Off. Outgoing email works without it; bounces and replies just won&apos;t appear in TRACE.SIGN.</p>
        )}
      </section>

      {/* ── Notifications ─────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>5 · Administrator notifications</h2>
            <p>Recipients always receive invitations, reminders, expiry notices and the completed PDF.</p>
          </div>
        </div>
        <div className="grid g2">
          <label className="f">
            Notify this address
            <span className="hint">Defaults to the administrator login email.</span>
            <input type="email" value={f.adminNotifyEmail} onChange={(e) => set("adminNotifyEmail", e.target.value)} placeholder="you@trace-studio.tech" />
          </label>
          <div className="stack" style={{ gap: 10 }}>
            {(
              [
                ["notifyOnOpen", "A recipient opens a document"],
                ["notifyOnDecline", "A recipient declines"],
                ["notifyOnComplete", "A document is fully signed"],
                ["notifyOnExpire", "A request expires"],
              ] as [keyof Form, string][]
            ).map(([k, l]) => (
              <label className="check" key={k}>
                <input type="checkbox" checked={f[k] as boolean} onChange={(e) => set(k, e.target.checked as never)} />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <span className="spacer" />
          <button className="btn primary" onClick={save} disabled={busy !== null || !dirty}>
            {busy === "save" ? "Saving…" : dirty ? "Save settings" : "Saved"}
          </button>
        </div>
      </section>

      {/* ── DNS ───────────────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>6 · Domain authentication for {domain}</h2>
            <p>SPF, DKIM and DMARC let Gmail, Outlook and others trust mail from {f.fromEmail}. Add these at your DNS host.</p>
          </div>
          <button
            className="btn ghost"
            disabled={busy !== null}
            onClick={() =>
              run("dns", async () => {
                try {
                  setDns(await api("/api/admin/email/dns-check", { json: {} }));
                } catch (e) {
                  setDns({ domain, checks: [{ name: "DNS check", status: "fail", found: [], advice: (e as Error).message }] });
                }
              })
            }
          >
            {busy === "dns" ? "Checking…" : "Check live DNS"}
          </button>
        </div>
        <div>
          {recordsFor(preset === "custom" ? providerOf(saved.smtpHost ?? "") : preset, domain).map((r, i) => (
            <div className="dns-rec" key={i}>
              <div>
                <span className="pill neutral">{r.type}</span>
              </div>
              <div className="mono">{r.host}</div>
              <div>
                <code>{r.value}</code>
                {r.note && <div className="small muted" style={{ marginTop: 6 }}>{r.note}</div>}
              </div>
            </div>
          ))}
        </div>
        {dns && (
          <div className="stack" style={{ marginTop: 18 }}>
            <h3>Live results for {dns.domain}</h3>
            {dns.checks.map((c) => (
              <div key={c.name} className={`note ${c.status === "pass" ? "ok" : c.status === "warn" ? "warn" : "bad"}`}>
                <strong>
                  {c.name}: {c.status === "pass" ? "OK" : c.status === "warn" ? "Needs attention" : "Missing / invalid"}
                </strong>
                {c.found.length > 0 && (
                  <div className="mono" style={{ margin: "4px 0", wordBreak: "break-all" }}>
                    {c.found.map((x) => (
                      <div key={x}>{x}</div>
                    ))}
                  </div>
                )}
                {c.advice}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
