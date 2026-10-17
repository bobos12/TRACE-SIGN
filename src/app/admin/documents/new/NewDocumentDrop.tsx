"use client";
import { useRouter } from "next/navigation";
import { PdfDrop } from "@/components/Upload";

export function NewDocumentDrop() {
  const router = useRouter();
  return <PdfDrop url="/api/admin/documents" onDone={(id) => router.push(`/admin/documents/${id}/edit`)} />;
}
