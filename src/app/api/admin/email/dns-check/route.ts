import { adminRoute } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { checkDomain, providerFromHost } from "@/lib/mail/dns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminRoute(async () => {
  const s = await getSettings();
  const domain = s.fromEmail.split("@")[1];
  const provider = providerFromHost(s.smtpHost);
  return { domain, provider, checks: await checkDomain(domain, provider) };
});
