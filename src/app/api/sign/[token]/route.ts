import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFrom, kickOutbox, publicGuard, toResponse } from "@/lib/api";
import { completeSigning, declineAsRecipient, recordConsent, signInput } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("consent") }),
  z.object({ action: z.literal("complete") }).merge(signInput),
  z.object({ action: z.literal("decline"), reason: z.string().max(1000).default("") }),
]);

/** Everything a signer can do. The token identifies exactly one recipient; nothing else is reachable. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const blocked = publicGuard(req, "sign", 40);
  if (blocked) return blocked;
  try {
    const b = body.parse(await req.json());
    const who = actorFrom(req, "recipient");
    if (b.action === "consent") return NextResponse.json(await recordConsent(params.token, who));
    if (b.action === "complete") await completeSigning(params.token, b, who);
    else await declineAsRecipient(params.token, b.reason, who);
    await kickOutbox();
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Please agree to sign electronically and complete your fields." }, { status: 400 });
    return toResponse(e);
  }
}
