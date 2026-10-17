/**
 * Long-running worker for VPS / Docker / Railway / Render deployments.
 *   npm run worker
 * Sends queued email every 20s, and checks reminders, expiries and the IMAP mailbox
 * every 2 minutes. On Vercel, use the cron route (/api/cron/tick) instead.
 */
import { runTick } from "../src/lib/tick";
import { processOutbox } from "../src/lib/mail/outbox";

const FAST_MS = 20_000;
const SLOW_MS = 120_000;
let stopping = false;
let lastSlow = 0;

function summary(o: unknown) {
  // Counts only — never log message contents or configuration.
  return JSON.stringify(o);
}

async function loop() {
  while (!stopping) {
    try {
      if (Date.now() - lastSlow >= SLOW_MS) {
        lastSlow = Date.now();
        console.log(new Date().toISOString(), "tick", summary(await runTick()));
      } else {
        const r = await processOutbox({ limit: 50 });
        if ("sent" in r && (r.sent || r.failed || r.retrying || r.paused)) console.log(new Date().toISOString(), "outbox", summary(r));
      }
    } catch (e) {
      console.error(new Date().toISOString(), "worker error:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, FAST_MS));
  }
  process.exit(0);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`received ${sig}, finishing current pass…`);
    stopping = true;
  });
}

console.log("TRACE.SIGN worker started");
void loop();
