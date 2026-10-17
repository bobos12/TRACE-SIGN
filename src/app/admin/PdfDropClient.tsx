"use client";
import { useRouter } from "next/navigation";
import { PdfDrop } from "@/components/Upload";

export function PdfDropClient() {
  const router = useRouter();
  return <PdfDrop url="/api/admin/documents" title="Send your first document" hint="Drop a PDF here, or click to browse. You'll place signature fields next." onDone={(id) => router.push(`/admin/documents/${id}/edit`)} />;
}
