import { promises as dns } from "dns";

export interface DnsCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  found: string[];
  advice: string;
}

const DKIM_SELECTORS: Record<string, string[]> = {
  hostinger: ["hostingermail-a", "hostingermail-b", "hostingermail-c"],
  google: ["google"],
  microsoft: ["selector1", "selector2"],
  zoho: ["zmail", "zoho"],
  generic: ["default", "mail", "dkim", "s1", "k1"],
};

const SPF_INCLUDES: Record<string, string> = {
  hostinger: "include:_spf.mail.hostinger.com",
  google: "include:_spf.google.com",
  microsoft: "include:spf.protection.outlook.com",
  zoho: "include:zohomail.com",
};

async function txt(name: string): Promise<string[]> {
  try {
    return (await dns.resolveTxt(name)).map((parts) => parts.join(""));
  } catch {
    return [];
  }
}

async function cname(name: string): Promise<string[]> {
  try {
    return await dns.resolveCname(name);
  } catch {
    return [];
  }
}

export function providerFromHost(smtpHost?: string | null): string {
  const h = (smtpHost || "").toLowerCase();
  if (h.includes("hostinger")) return "hostinger";
  if (h.includes("gmail") || h.includes("google")) return "google";
  if (h.includes("office365") || h.includes("outlook")) return "microsoft";
  if (h.includes("zoho")) return "zoho";
  return "generic";
}

/** Live DNS lookups for the sending domain. Runs on the server (Node resolver). */
export async function checkDomain(domain: string, provider: string): Promise<DnsCheck[]> {
  const out: DnsCheck[] = [];

  // If this server can't resolve anything at all, say so instead of reporting every record "missing".
  const canary = await dns.resolveNs(domain).then(() => true, () => dns.resolve4("one.one.one.one").then(() => true, () => false));
  if (!canary) {
    return [
      {
        name: "DNS lookup",
        status: "warn",
        found: [],
        advice: `This server couldn't reach a DNS resolver, so the records for ${domain} weren't checked. Check them with your DNS host or a public tool such as MXToolbox instead.`,
      },
    ];
  }

  // MX
  let mx: string[] = [];
  try {
    mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((m) => `${m.priority} ${m.exchange}`);
  } catch {
    /* none */
  }
  out.push({
    name: "MX (incoming mail)",
    status: mx.length ? "pass" : "fail",
    found: mx,
    advice: mx.length ? "Mail for the domain has a destination, so replies and bounces can reach the mailbox." : `No MX records on ${domain}. Replies to ${domain} addresses cannot be delivered.`,
  });

  // SPF
  const spf = (await txt(domain)).filter((t) => t.toLowerCase().startsWith("v=spf1"));
  const want = SPF_INCLUDES[provider];
  let spfStatus: DnsCheck["status"] = "pass";
  let spfAdvice = "SPF authorizes your mail provider to send for the domain.";
  if (spf.length === 0) {
    spfStatus = "fail";
    spfAdvice = `No SPF record. Add a TXT record on ${domain}: ${want ? `v=spf1 ${want} ~all` : "v=spf1 include:<your provider's SPF domain> ~all"}`;
  } else if (spf.length > 1) {
    spfStatus = "fail";
    spfAdvice = "More than one SPF record exists. Receivers treat that as a permanent error. Merge them into a single TXT record.";
  } else if (want && !spf[0].toLowerCase().includes(want)) {
    spfStatus = "warn";
    spfAdvice = `SPF exists but doesn't contain ${want}. Add it inside the existing record (don't create a second one).`;
  } else if (/\+all/.test(spf[0])) {
    spfStatus = "fail";
    spfAdvice = "SPF ends in +all, which lets anyone send as your domain. Use ~all or -all.";
  }
  out.push({ name: "SPF", status: spfStatus, found: spf, advice: spfAdvice });

  // DKIM
  const selectors = DKIM_SELECTORS[provider] ?? DKIM_SELECTORS.generic;
  const found: string[] = [];
  for (const sel of selectors) {
    const host = `${sel}._domainkey.${domain}`;
    const c = await cname(host);
    if (c.length) {
      found.push(`${host} → CNAME ${c[0]}`);
      continue;
    }
    const t = (await txt(host)).filter((v) => /v=DKIM1|p=/i.test(v));
    if (t.length) found.push(`${host} → TXT ${t[0].slice(0, 60)}…`);
  }
  out.push({
    name: "DKIM",
    status: found.length ? (provider === "hostinger" && found.length < 3 ? "warn" : "pass") : "fail",
    found,
    advice: found.length
      ? provider === "hostinger" && found.length < 3
        ? "Hostinger uses three DKIM selectors (hostingermail-a, -b, -c). Add the missing CNAME records."
        : "DKIM signing records are published."
      : `No DKIM record found for the usual ${provider === "generic" ? "" : provider + " "}selectors (${selectors.join(", ")}). Enable DKIM in your email provider's panel and publish the record it gives you.`,
  });

  // DMARC
  const dmarc = (await txt(`_dmarc.${domain}`)).filter((t) => t.toLowerCase().startsWith("v=dmarc1"));
  const policy = /p=(none|quarantine|reject)/i.exec(dmarc[0] ?? "")?.[1]?.toLowerCase();
  out.push({
    name: "DMARC",
    status: !dmarc.length ? "fail" : dmarc.length > 1 ? "fail" : policy === "none" ? "warn" : "pass",
    found: dmarc,
    advice: !dmarc.length
      ? `No DMARC record. Add TXT at _dmarc.${domain}: v=DMARC1; p=none; rua=mailto:dmarc@${domain}; adkim=r; aspf=r`
      : dmarc.length > 1
        ? "Multiple DMARC records. Keep exactly one."
        : policy === "none"
          ? "DMARC is in monitoring mode (p=none). Once reports show SPF and DKIM passing for 2–4 weeks, move to p=quarantine, then p=reject."
          : `DMARC is enforcing (p=${policy}).`,
  });

  return out;
}
