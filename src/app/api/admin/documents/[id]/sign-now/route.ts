import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getDocument, recipientsOf } from "@/lib/documents";
import { signingToken } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in sender signs their own part in the same signing experience recipients use. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  try {
    const d = await getDocument(params.id, user.orgId);
    const me = (await recipientsOf(d.id)).find((r) => r.email === user.email && (r.status === "sent" || r.status === "opened"));
    if (d.status !== "sent" || !me) return NextResponse.redirect(new URL(`/admin/documents/${d.id}`, req.url));
    const token = signingToken(me.id, me.tokenVersion, Date.now() + 2 * 3600_000);
    return NextResponse.redirect(new URL(`/sign/${token}`, req.url));
  } catch {
    return NextResponse.redirect(new URL("/admin/documents", req.url));
  }
}
