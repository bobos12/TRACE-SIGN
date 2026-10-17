/** Safe file name for Content-Disposition. */
export function fileNameFor(title: string, suffix = "") {
  return `${title.replace(/[^\w\- ]+/g, "").trim().slice(0, 120) || "document"}${suffix}.pdf`;
}

export function pdfResponse(data: Buffer, name: string, download = false) {
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
