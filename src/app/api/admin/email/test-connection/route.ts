import { adminRoute } from "@/lib/api";
import { testSmtpConnection } from "@/lib/mail/smtp-tests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminRoute(async () => testSmtpConnection());
