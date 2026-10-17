import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { env } from "./env";

// ── Credential encryption (AES-256-GCM) ────────────────────────────────────
// Stored format: v1:<iv b64>:<auth tag b64>:<ciphertext b64>

function key(): Buffer {
  const k = Buffer.from(env.encryptionKey(), "base64");
  if (k.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64-encoded (run: npm run gen:key).");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from("trace-sign:settings"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Stored credential has an unknown format.");
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAAD(Buffer.from("trace-sign:settings"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt the stored mailbox password. Was SETTINGS_ENCRYPTION_KEY changed? Re-enter the password in Email Integration.");
  }
}

// ── HMAC helpers ───────────────────────────────────────────────────────────

export function hmac(purpose: string, data: string): string {
  return createHmac("sha256", env.sessionSecret()).update(`${purpose}\n${data}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ── Document encryption at rest (AES-256-GCM) ──────────────────────────────
// Stored format: "TSE1" | iv (12) | tag (16) | ciphertext. Data without the
// prefix is legacy plaintext and is returned unchanged.

const BLOB_MAGIC = Buffer.from("TSE1");

export function sealBlob(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from("trace-sign:blob"));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([BLOB_MAGIC, iv, cipher.getAuthTag(), ct]);
}

export function openBlob(stored: Buffer | null | undefined): Buffer | null {
  if (!stored) return null;
  const buf = Buffer.isBuffer(stored) ? stored : Buffer.from(stored);
  if (buf.length < 32 || !buf.subarray(0, 4).equals(BLOB_MAGIC)) return buf;
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(4, 16));
  d.setAAD(Buffer.from("trace-sign:blob"));
  d.setAuthTag(buf.subarray(16, 32));
  try {
    return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
  } catch {
    throw new Error("Stored document could not be decrypted (wrong SETTINGS_ENCRYPTION_KEY, or the data was altered).");
  }
}

// ── Signing-link tokens ────────────────────────────────────────────────────
// token = <recipientId>.<version>.<expiry base36 seconds>.<hmac>. Nothing secret
// is stored; bumping Recipient.tokenVersion revokes every earlier link, and the
// expiry is covered by the MAC so it can't be extended. Legacy 3-part tokens
// (v1, no expiry) are still accepted until revoked.

export const DEFAULT_LINK_TTL_MS = 30 * 86400_000;

export function signingToken(recipientId: string, version: number, expiresAt?: Date | number): string {
  if (expiresAt === undefined) return `${recipientId}.${version}.${hmac("sign-link", `${recipientId}.${version}`).slice(0, 32)}`;
  const exp = Math.floor(new Date(expiresAt).getTime() / 1000).toString(36);
  return `${recipientId}.${version}.${exp}.${hmac("sign-link-v2", `${recipientId}.${version}.${exp}`).slice(0, 32)}`;
}

export function parseSigningToken(token: string): { recipientId: string; version: number; expiresAt: Date | null; expired: boolean } | null {
  const parts = token.split(".");
  if (parts.length === 3) {
    const [recipientId, v, mac] = parts;
    const version = Number(v);
    if (!recipientId || !Number.isInteger(version)) return null;
    const expected = hmac("sign-link", `${recipientId}.${version}`).slice(0, 32);
    return safeEqual(mac, expected) ? { recipientId, version, expiresAt: null, expired: false } : null;
  }
  if (parts.length !== 4) return null;
  const [recipientId, v, exp, mac] = parts;
  const version = Number(v);
  const expSec = parseInt(exp, 36);
  if (!recipientId || !Number.isInteger(version) || !Number.isFinite(expSec)) return null;
  const expected = hmac("sign-link-v2", `${recipientId}.${version}.${exp}`).slice(0, 32);
  if (!safeEqual(mac, expected)) return null;
  const expiresAt = new Date(expSec * 1000);
  return { recipientId, version, expiresAt, expired: expiresAt.getTime() < Date.now() };
}

// ── API keys ───────────────────────────────────────────────────────────────

export function newApiKey(): { key: string; prefix: string; hash: string } {
  const key = `tsk_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: sha256Hex(key) };
}

export function randomSecret(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

// ── Admin password (scrypt) ────────────────────────────────────────────────
// Hash format: scrypt:<salt b64>:<hash b64>  (no "$", which .env loaders would try to expand)

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}
