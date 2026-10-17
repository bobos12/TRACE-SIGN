import { adminRoute } from "@/lib/api";
import { syncMailbox } from "@/lib/mail/imap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = adminRoute(async () => {
  const r = await syncMailbox();
  return "skipped" in r ? { ok: false, error: "A mailbox sync is already running." } : { ok: !r.error, ...r };
});
