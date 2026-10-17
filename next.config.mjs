/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    // Vercel Functions cap request/response bodies at 4.5 MB, so uploads stay under 4 MB there.
    NEXT_PUBLIC_MAX_PDF_MB: process.env.MAX_PDF_MB || (process.env.VERCEL ? "4" : "25"),
  },
  experimental: {
    // Mail libraries use Node APIs (net/tls/streams) and must not be bundled for the edge.
    serverComponentsExternalPackages: ["nodemailer", "imapflow", "mailparser", "pdf-lib", "pg", "@electric-sql/pglite", "node-forge", "@signpdf/signpdf", "@signpdf/placeholder-pdf-lib", "@signpdf/signer-p12", "@pdf-lib/fontkit"],
    // Read with readFileSync at runtime (default logo in emails and /api/brand/logo).
    outputFileTracingIncludes: { "/**/*": ["./public/brand/trace-sign-mark.png"] },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
