import { adminRoute } from "@/lib/api";
import { testImapConnection } from "@/lib/mail/imap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminRoute(async () => testImapConnection());
