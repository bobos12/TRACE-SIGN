import { NextResponse } from "next/server";
import { userRoute } from "@/lib/api";
import { getDocument, inProgressPdf, originalPdf } from "@/lib/documents";
import { openBlob } from "@/lib/crypto";
import { fileNameFor, pdfResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?which=original | current | completed | audit  &download=1 */
export const GET = userRoute(async (req, { params }, user) => {
  const q = new URL(req.url).searchParams;
  const which = q.get("which") ?? "original";
  const d = await getDocument(params.id, user.orgId);
  const data =
    which === "completed" ? openBlob(d.completedPdf) : which === "audit" ? openBlob(d.auditPdf) : which === "current" ? (d.completedPdf ? openBlob(d.completedPdf) : await inProgressPdf(d)) : originalPdf(d);
  if (!data) return NextResponse.json({ error: "Not available yet." }, { status: 404 });
  return pdfResponse(data, fileNameFor(d.title, which === "completed" ? " (signed)" : which === "audit" ? " (audit trail)" : ""), q.get("download") === "1");
});
