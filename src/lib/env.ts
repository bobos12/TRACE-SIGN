
function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return v.trim();
}

/** Base URL of this TRACE.SIGN deployment, without trailing slash. All email links use it. */
export function appUrl(): string {
  const raw = required("APP_URL").replace(/\/+$/, "");
  const u = new URL(raw);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (process.env.NODE_ENV === "production" && u.protocol !== "https:" && !local) {
    throw new Error("APP_URL must use https in production.");
  }
  return raw;
}

export function appHost(): string {
  return new URL(appUrl()).host;
}

export const env = {
  encryptionKey: () => required("SETTINGS_ENCRYPTION_KEY"),
  sessionSecret: () => required("SESSION_SECRET"),
  adminEmail: () => required("ADMIN_EMAIL").toLowerCase(),
  adminPasswordHash: () => required("ADMIN_PASSWORD_HASH"),
  cronSecret: () => process.env.CRON_SECRET?.trim() || "",
  webhookSecret: () => process.env.EMAIL_WEBHOOK_SECRET?.trim() || "",
};
