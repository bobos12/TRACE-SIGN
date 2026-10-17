import { NextResponse } from "next/server";
import { publicGuard } from "@/lib/api";
import { inProgressPdf, resolveToken, signState } from "@/lib/documents";
import { openBlob } from "@/lib/crypto";
import { fileNameFor, pdfResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The document for a valid link: the sealed signed copy once completed, otherwise the current state. */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const blocked = publicGuard(req, "sign-pdf", 60);
  if (blocked) return blocked;
  const s = await resolveToken(params.token);
  if (!s) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  const state = signState(s);
  if (state === "voided" || state === "link_expired") return NextResponse.json({ error: "This link is no longer active." }, { status: 410 });
  const d = s.document;
  const download = new URL(req.url).searchParams.get("download") === "1";
  if (d.status === "completed") {
    const pdf = openBlob(d.completedPdf);
    if (!pdf) return NextResponse.json({ error: "The signed copy is still being prepared." }, { status: 409 });
    return pdfResponse(pdf, fileNameFor(d.title, " (signed)"), download);
  }
  return pdfResponse(await inProgressPdf(d), fileNameFor(d.title), download);
}
