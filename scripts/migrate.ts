/** Applies SQL migrations in ./drizzle to DATABASE_URL.  Usage: npm run db:migrate */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL first.");
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle: d } = await import("drizzle-orm/pglite");
    const { migrate: m } = await import("drizzle-orm/pglite/migrator");
    const dir = url.slice("pglite:".length) || "./.data/pglite";
    (await import("fs")).mkdirSync(dir, { recursive: true });
    const pg = new PGlite(dir);
    await m(d(pg), { migrationsFolder: "./drizzle" });
    await pg.close();
    console.log("Local PGlite database is up to date.");
    return;
  }
  const pool = new Pool({ connectionString: url, ssl: /sslmode=(require|verify)/.test(url) || /supabase|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("Database is up to date.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
