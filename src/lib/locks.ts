import { and, eq, lt } from "drizzle-orm";
import { db, t } from "./db";

/** Acquire a named lease. Returns false if another worker holds an unexpired lease. */
export async function acquireLock(name: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const inserted = await db.insert(t.jobLocks).values({ name, lockedAt: now, expiresAt }).onConflictDoNothing().returning();
  if (inserted.length) return true;
  const taken = await db
    .update(t.jobLocks)
    .set({ lockedAt: now, expiresAt })
    .where(and(eq(t.jobLocks.name, name), lt(t.jobLocks.expiresAt, now)))
    .returning();
  return taken.length === 1;
}

export async function releaseLock(name: string): Promise<void> {
  await db.delete(t.jobLocks).where(eq(t.jobLocks.name, name));
}

export async function withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | { skipped: true }> {
  if (!(await acquireLock(name, ttlMs))) return { skipped: true };
  try {
    return await fn();
  } finally {
    await releaseLock(name);
  }
}
