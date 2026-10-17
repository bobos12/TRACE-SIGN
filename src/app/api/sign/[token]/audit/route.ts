import { NextResponse } from "next/server";
import { publicGuard } from "@/lib/api";
import { resolveToken } from "@/lib/documents";
import { openBlob } from "@/lib/crypto";
import { fileNameFor, pdfResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Audit trail / certificate of completion for a party to a completed document (separate file). */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const blocked = publicGuard(req, "sign-pdf", 60);
  if (blocked) return blocked;
  const s = await resolveToken(params.token);
  if (!s || s.linkExpired || s.document.status !== "completed") return NextResponse.json({ error: "Not available." }, { status: 404 });
  const pdf = openBlob(s.document.auditPdf);
  if (!pdf) return NextResponse.json({ error: "Not available yet." }, { status: 409 });
  return pdfResponse(pdf, fileNameFor(s.document.title, " (audit trail)"), true);
}
