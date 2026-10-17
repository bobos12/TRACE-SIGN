import { AlarmClock, Ban, CheckCircle2, Clock, Download, FileText, LinkIcon, ShieldCheck, XCircle } from "lucide-react";
import { fieldsOf, pagesOf, resolveToken, signState } from "@/lib/documents";
import { getOrg } from "@/lib/org";
import { Mark, Wordmark } from "@/components/Logo";
import { SignRoom } from "@/components/signing/SignRoom";
import { ToastProvider } from "@/components/ui";
import { SignedViewer } from "./SignedViewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review & sign", robots: { index: false, follow: false } };

function Frame({ brand, children }: { brand: string; children: React.ReactNode }) {
  return (
    <div className="public">
      <header className="public-top">
        <Mark size={24} />
        <Wordmark name={brand} />
      </header>
      <main className="public-main">{children}</main>
      <footer className="public-foot">
        POWERED BY <strong>TRACE.STUDIO</strong>
      </footer>
    </div>
  );
}

function Hero({ tone, icon, title, children }: { tone?: "warn" | "bad"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="status-hero">
      <div className={`ic ${tone ?? ""}`}>{icon}</div>
      <h1>{title}</h1>
      <div style={{ color: "var(--text-2)", marginTop: 8 }}>{children}</div>
    </div>
  );
}

export default async function SignPage({ params }: { params: { token: string } }) {
  const s = await resolveToken(params.token);
  if (!s) {
    return (
      <Frame brand="TRACE.SIGN">
        <Hero tone="bad" icon={<LinkIcon size={24} />} title="This link isn't valid">
          It may have been replaced by a newer email, or the request was withdrawn. Reply to the email you received if you need a new link.
        </Hero>
      </Frame>
    );
  }
  const { recipient: r, document: d } = s;
  const org = await getOrg(d.orgId);
  const state = signState(s);
  const enc = encodeURIComponent(params.token);

  if (state === "open") {
    const mine = (await fieldsOf(d.id)).filter((f) => f.recipientId === r.id);
    return (
      <ToastProvider>
        <SignRoom
          token={params.token}
          brand={{ name: org.brandName, company: org.name, accent: org.accentColor, orgId: org.id }}
          doc={{ title: d.title, senderName: d.senderName, message: d.message, pages: pagesOf(d), expiresAt: d.expiresAt?.toISOString() ?? null }}
          recipient={{ name: r.name, email: r.email, color: org.accentColor, consented: !!r.consentAt }}
          fields={mine.map((f) => ({
            id: f.id,
            type: f.type as never,
            page: f.page,
            x: f.x,
            y: f.y,
            w: f.w,
            h: f.h,
            required: f.required,
            label: f.label,
            placeholder: f.placeholder,
            defaultValue: f.defaultValue,
            options: f.options ? JSON.parse(f.options) : {},
          }))}
          dateFormat={org.dateFormat}
          timeZone={org.timezone}
        />
      </ToastProvider>
    );
  }

  const pages = pagesOf(d);
  const body = (() => {
    switch (state) {
      case "completed":
        return (
          <Hero icon={<CheckCircle2 size={26} />} title="This document is complete">
            Everyone has signed <b>{d.title}</b>. Download your copy below. The audit trail is a separate file.
            <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
              <a className="btn primary" href={`/api/sign/${enc}/pdf?download=1`}>
                <Download size={15} /> Signed PDF
              </a>
              <a className="btn" href={`/api/sign/${enc}/audit`}>
                <ShieldCheck size={15} /> Audit trail
              </a>
            </div>
          </Hero>
        );
      case "signed":
        return (
          <Hero icon={<CheckCircle2 size={26} />} title="You've signed">
            Thanks, {r.name.split(" ")[0]}. We&apos;ll email you the completed document once everyone has signed.
            <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
              <a className="btn" href={`/api/sign/${enc}/pdf?download=1`}>
                <Download size={15} /> Download a copy
              </a>
            </div>
          </Hero>
        );
      case "waiting":
        return (
          <Hero tone="warn" icon={<Clock size={24} />} title="Not your turn yet">
            <b>{d.title}</b> is being signed in order. We&apos;ll email you as soon as it&apos;s ready for you.
          </Hero>
        );
      case "declined":
        return (
          <Hero tone="bad" icon={<XCircle size={24} />} title="This request was declined">
            The signature request for <b>{d.title}</b> was declined and is closed.
          </Hero>
        );
      case "expired":
        return (
          <Hero tone="warn" icon={<AlarmClock size={24} />} title="This request has expired">
            The deadline to sign <b>{d.title}</b> has passed. Reply to the invitation email to ask {d.senderName} for a new request.
          </Hero>
        );
      case "voided":
        return (
          <Hero tone="warn" icon={<Ban size={24} />} title="This request was cancelled">
            {d.senderName} cancelled the request to sign <b>{d.title}</b>. You don&apos;t need to do anything.
          </Hero>
        );
      case "link_expired":
        return (
          <Hero tone="warn" icon={<LinkIcon size={24} />} title="This link has expired">
            For your security, signing links expire. Reply to the email you received and {d.senderName} can send you a new one.
          </Hero>
        );
      default:
        return (
          <Hero icon={<FileText size={24} />} title={d.title}>
            Nothing to do here.
          </Hero>
        );
    }
  })();

  return (
    <Frame brand={org.brandName}>
      {body}
      {(state === "completed" || state === "signed") && <SignedViewer src={`/api/sign/${enc}/pdf`} pages={pages} />}
    </Frame>
  );
}
