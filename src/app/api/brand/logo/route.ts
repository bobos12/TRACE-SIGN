import { readFileSync } from "fs";
import { join } from "path";
import { getOrg } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public workspace logo (?org=<id>), used on signing pages. Falls back to the TRACE mark. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("org") || "default";
  let png: Buffer | null = null;
  try {
    png = (await getOrg(/^[\w-]{1,64}$/.test(id) ? id : "default")).logoPng;
  } catch {
    png = null;
  }
  png ??= readFileSync(join(process.cwd(), "public", "brand", "trace-sign-mark.png"));
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
