// Fixed-window rate limiter (per server instance). Good enough for a single Node
// process or a small fleet behind sticky sessions; swap for Redis when scaling out.

const buckets = new Map<string, { n: number; resetAt: number }>();
let lastSweep = Date.now();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
    lastSweep = now;
  }
  let b = buckets.get(key);
  if (!b || b.resetAt < now) {
    b = { n: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.n++;
  return { ok: b.n <= max, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}
