import { getSettings, publicSettings } from "@/lib/settings";
import { EmailIntegration, type SettingsView } from "@/components/EmailIntegration";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email Integration" };

export default async function EmailIntegrationPage() {
  const s = publicSettings(await getSettings());
  // Dates → ISO strings for the client component. No secrets are in publicSettings.
  const view = JSON.parse(JSON.stringify(s)) as SettingsView;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Email Integration</h1>
          <p>Connect your company mailbox so TRACE.SIGN sends and receives signature email as {s.fromEmail}.</p>
        </div>
      </div>
      <EmailIntegration initial={view} />
    </>
  );
}
