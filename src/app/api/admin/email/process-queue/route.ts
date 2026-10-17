import { adminRoute } from "@/lib/api";
import { processOutbox } from "@/lib/mail/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = adminRoute(async () => processOutbox({ limit: 50 }));
