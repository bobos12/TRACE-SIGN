// Provider presets shown on the Email Integration page. Safe for the browser (no secrets).

export type SmtpSecurity = "ssl" | "starttls" | "none";

export interface ProviderPreset {
  id: string;
  label: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  imapHost: string;
  imapPort: number;
  note?: string;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: "hostinger",
    label: "Hostinger Email",
    smtpHost: "smtp.hostinger.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imap.hostinger.com",
    imapPort: 993,
    note: "Log in with the full mailbox address and its password. If port 465 is blocked by your host, use 587 with STARTTLS.",
  },
  {
    id: "google",
    label: "Google Workspace",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    note: "Requires 2-Step Verification and an App Password. Add the alias under Gmail → Settings → Accounts → Send mail as.",
  },
  {
    id: "microsoft",
    label: "Microsoft 365",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecurity: "starttls",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    note: "SMTP AUTH must be enabled for the mailbox, and the alias must be granted Send As. Some tenants require OAuth instead of passwords.",
  },
  {
    id: "zoho",
    label: "Zoho Mail",
    smtpHost: "smtppro.zoho.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imappro.zoho.com",
    imapPort: 993,
    note: "Use an application-specific password if 2FA is on. Add the alias under Mail Accounts → Send Mail As.",
  },
  {
    id: "custom",
    label: "Other SMTP provider",
    smtpHost: "",
    smtpPort: 587,
    smtpSecurity: "starttls",
    imapHost: "",
    imapPort: 993,
  },
];
