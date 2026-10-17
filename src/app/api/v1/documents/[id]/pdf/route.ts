import { NextResponse } from "next/server";
import { apiKeyRoute } from "@/lib/api";
import { getDocument, originalPdf } from "@/lib/documents";
import { openBlob } from "@/lib/crypto";
import { fileNameFor, pdfResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?which=completed (default) | audit | original */
export const GET = apiKeyRoute(async (req, { params }, c) => {
  const which = new URL(req.url).searchParams.get("which") ?? "completed";
  const d = await getDocument(params.id, c.orgId);
  const data = which === "audit" ? openBlob(d.auditPdf) : which === "original" ? originalPdf(d) : openBlob(d.completedPdf);
  if (!data) return NextResponse.json({ error: "Not available yet. The document must be completed first." }, { status: 404 });
  return pdfResponse(data, fileNameFor(d.title, which === "audit" ? " (audit trail)" : which === "original" ? "" : " (signed)"), true);
});
