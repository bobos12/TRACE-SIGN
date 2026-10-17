import { adminRoute } from "@/lib/api";
import { getSettings, publicSettings, saveSettings, settingsInput } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => publicSettings(await getSettings()));

export const PUT = adminRoute(async (req) => {
  const input = settingsInput.parse(await req.json());
  return publicSettings(await saveSettings(input));
});
