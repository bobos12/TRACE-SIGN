import { expireDueDocuments, purgeExpiredData, sendDueReminders } from "./documents";
import { processOutbox } from "./mail/outbox";
import { syncMailbox } from "./mail/imap";
import { getSettings } from "./settings";
import { withLock } from "./locks";
import { processWebhooks } from "./webhooks";

/** One scheduler pass: expiries → reminders → retention → send queue → webhooks → read mailbox. */
export async function runTick(opts: { imap?: boolean } = {}) {
  const out: Record<string, unknown> = {};
  out.scheduler = await withLock("scheduler", 5 * 60_000, async () => ({
    expired: await expireDueDocuments(),
    reminders: await sendDueReminders(),
    purged: await purgeExpiredData(),
  }));
  out.outbox = await processOutbox({ limit: 50 });
  out.webhooks = await processWebhooks(50);
  if (opts.imap !== false) {
    const s = await getSettings();
    if (s.imapEnabled) out.imap = await syncMailbox();
  }
  return out;
}
