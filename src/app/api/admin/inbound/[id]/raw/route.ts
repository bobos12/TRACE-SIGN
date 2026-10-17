import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/api";
import { db, t } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Downloads the preserved original message as an .eml file. */
export const GET = adminRoute(async (_req, { params }) => {
  const [m] = await db.select().from(t.inboundEmails).where(eq(t.inboundEmails.id, params.id));
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(m.rawSource, {
    headers: {
      "Content-Type": "message/rfc822",
      "Content-Disposition": `attachment; filename="message-${m.id}.eml"`,
      "Cache-Control": "no-store",
    },
  });
});
