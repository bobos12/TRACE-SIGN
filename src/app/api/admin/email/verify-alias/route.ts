import { z } from "zod";
import { adminRoute } from "@/lib/api";
import { verifyAliasViaImap } from "@/lib/mail/imap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminRoute(async (req) => {
  const { messageId } = z.object({ messageId: z.string().min(3).max(300) }).parse(await req.json());
  return verifyAliasViaImap(messageId);
});
