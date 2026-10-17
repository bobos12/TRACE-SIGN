"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Mark, Wordmark } from "@/components/Logo";
import { Spinner } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth">
      <div className="auth-art">
        <div className="brand" style={{ padding: 0, color: "#f2f2ef" }}>
          <Mark size={26} accent="#ff5a33" />
          <span className="brand-word" style={{ color: "#f2f2ef" }}>
            TRACE<b>.</b>SIGN
          </span>
        </div>
        <div>
          <h2>Prepare, send and sign documents in minutes.</h2>
          <p>Place signature, name and date fields directly on your PDF. Recipients sign from any device without creating an account.</p>
        </div>
        <div className="xs" style={{ color: "#6f6e68", letterSpacing: ".1em" }}>
          POWERED BY <strong style={{ color: "#c9c8c1" }}>TRACE.STUDIO</strong>
        </div>
        <div className="auth-sheet" aria-hidden="true">
          <i style={{ width: "70%" }} />
          <i />
          <i />
          <i style={{ width: "85%" }} />
          <i />
          <i style={{ width: "60%" }} />
          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
            <div style={{ flex: 1, height: 34, border: "1.5px solid #3b6ff5", background: "rgba(59,111,245,.1)", borderRadius: 4, fontSize: 10, color: "#2546a8", display: "flex", alignItems: "center", padding: "0 6px", fontWeight: 600 }}>Signature</div>
            <div style={{ width: 70, height: 34, border: "1.5px solid #e8590c", background: "rgba(232,89,12,.1)", borderRadius: 4, fontSize: 10, color: "#9c3c08", display: "flex", alignItems: "center", padding: "0 6px", fontWeight: 600 }}>Date</div>
          </div>
        </div>
      </div>
      <div className="auth-form">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
            if (r.ok) window.location.href = "/admin";
            else {
              setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Sign-in failed");
              setBusy(false);
            }
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <div className="brand" style={{ padding: "0 0 20px" }}>
              <Mark size={24} />
              <Wordmark />
            </div>
            <h1>Welcome back</h1>
            <p className="muted" style={{ marginTop: 6 }}>Sign in to your workspace.</p>
          </div>
          <label className="f">
            Email
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="f">
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {err && <div className="note bad">{err}</div>}
          <button className="btn primary lg block" disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? "Signing in…" : "Sign in"}
            {!busy && <ArrowRight size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
}
