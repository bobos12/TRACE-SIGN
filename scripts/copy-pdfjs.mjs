// Copies the pdf.js worker, standard fonts and CMaps into public/pdfjs so the browser
// can load them from this app's own origin (no CDN). Runs on install, dev and build.
import { cpSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("pdfjs-dist/package.json"));
const out = join(process.cwd(), "public", "pdfjs");
mkdirSync(out, { recursive: true });
cpSync(join(root, "legacy", "build", "pdf.worker.min.mjs"), join(out, "pdf.worker.min.mjs"));
for (const d of ["standard_fonts", "cmaps"]) if (existsSync(join(root, d))) cpSync(join(root, d), join(out, d), { recursive: true });
console.log("pdf.js assets copied to public/pdfjs");
