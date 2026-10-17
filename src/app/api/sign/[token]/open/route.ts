import { NextResponse } from "next/server";
import { actorFrom, kickOutbox, publicGuard } from "@/lib/api";
import { markOpened, resolveToken, signState } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records the first view. Called by the signing page's script rather than on page load,
 * so link scanners (Outlook Safe Links, Gmail previews) don't trigger false "opened" alerts.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const blocked = publicGuard(req, "sign-open", 30);
  if (blocked) return blocked;
  const s = await resolveToken(params.token);
  if (!s) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  if (signState(s) === "open") {
    await markOpened(s, actorFrom(req, "recipient"));
    await kickOutbox();
  }
  return NextResponse.json({ ok: true });
}
