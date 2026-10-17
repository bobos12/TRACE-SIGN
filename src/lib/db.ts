import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const g = globalThis as unknown as { __tsDb?: DB; __tsPool?: Pool };

function create(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL. See .env.example.");
  if (url.startsWith("pglite:")) {
    // Local evaluation only: embedded PostgreSQL (WASM) stored in a folder. Not for production.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require("@electric-sql/pglite");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle: drizzlePglite } = require("drizzle-orm/pglite");
    const dir = url.slice("pglite:".length) || "./.data/pglite";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("fs").mkdirSync(dir, { recursive: true });
    return drizzlePglite(new PGlite(dir), { schema }) as DB;
  }
  const pool =
    g.__tsPool ??
    new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      // Supabase / Neon / most managed Postgres require TLS.
      ssl: /sslmode=(require|verify)/.test(url) || /supabase|neon\.tech|rds\.amazonaws/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
  g.__tsPool = pool;
  // No query logger: queries can carry encrypted credential blobs.
  return drizzle(pool, { schema });
}

/** Lazily-created database handle. Tests may set globalThis.__tsDb to another Drizzle instance. */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    if (!g.__tsDb) g.__tsDb = create();
    const v = (g.__tsDb as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(g.__tsDb) : v;
  },
});

export { schema };
export const t = schema;
