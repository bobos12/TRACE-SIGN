import { z } from "zod";
import { adminRoute } from "@/lib/api";
import { sendTestEmail } from "@/lib/mail/smtp-tests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminRoute(async (req) => {
  const { to } = z.object({ to: z.string().trim().toLowerCase().email() }).parse(await req.json());
  return sendTestEmail(to);
});
