// DNS records to publish for the sending domain, per provider. Safe for the browser.

export interface DnsRecord {
  type: "MX" | "TXT" | "CNAME";
  host: string;
  value: string;
  note?: string;
}

export function recordsFor(provider: string, domain: string): DnsRecord[] {
  const dmarc: DnsRecord = {
    type: "TXT",
    host: "_dmarc",
    value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}; adkim=r; aspf=r; pct=100`,
    note: `Start in monitoring mode. Create dmarc@${domain} (or point rua at an existing mailbox). After 2–4 weeks of passing reports, change p=none → p=quarantine → p=reject.`,
  };
  switch (provider) {
    case "hostinger":
      return [
        { type: "MX", host: "@", value: "5 mx1.hostinger.com", note: "Keep if already present. Needed so replies and bounces reach your mailbox." },
        { type: "MX", host: "@", value: "10 mx2.hostinger.com" },
        { type: "TXT", host: "@", value: "v=spf1 include:_spf.mail.hostinger.com ~all", note: "Only one SPF record per domain. If one exists, add the include to it instead of creating a second." },
        { type: "CNAME", host: "hostingermail-a._domainkey", value: "hostingermail-a.dkim.mail.hostinger.com" },
        { type: "CNAME", host: "hostingermail-b._domainkey", value: "hostingermail-b.dkim.mail.hostinger.com" },
        { type: "CNAME", host: "hostingermail-c._domainkey", value: "hostingermail-c.dkim.mail.hostinger.com", note: "If your DNS is managed by Hostinger, hPanel → Emails → DNS records can add all of these automatically." },
        dmarc,
      ];
    case "google":
      return [
        { type: "TXT", host: "@", value: "v=spf1 include:_spf.google.com ~all", note: "One SPF record per domain." },
        { type: "TXT", host: "google._domainkey", value: "(generated in Admin console → Apps → Gmail → Authenticate email)" },
        dmarc,
      ];
    case "microsoft":
      return [
        { type: "TXT", host: "@", value: "v=spf1 include:spf.protection.outlook.com ~all", note: "One SPF record per domain." },
        { type: "CNAME", host: "selector1._domainkey", value: "(shown in Microsoft Defender → Email authentication → DKIM)" },
        { type: "CNAME", host: "selector2._domainkey", value: "(shown in Microsoft Defender → Email authentication → DKIM)" },
        dmarc,
      ];
    case "zoho":
      return [
        { type: "TXT", host: "@", value: "v=spf1 include:zohomail.com ~all", note: "One SPF record per domain." },
        { type: "TXT", host: "zmail._domainkey", value: "(generated in Zoho Mail Admin → Domains → Email configuration → DKIM)" },
        dmarc,
      ];
    default:
      return [
        { type: "TXT", host: "@", value: "v=spf1 include:<your provider's SPF domain> ~all", note: "Ask your provider for the include value. One SPF record per domain." },
        { type: "TXT", host: "<selector>._domainkey", value: "(public key from your provider's DKIM settings)" },
        dmarc,
      ];
  }
}
