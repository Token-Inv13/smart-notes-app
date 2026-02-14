import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENC_PREFIX = "v1:";

function getRawSecret(): string | null {
  const direct = typeof process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY === "string"
    ? process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY.trim()
    : "";
  if (direct) return direct;

  const fallback = typeof process.env.APP_SECRET === "string" ? process.env.APP_SECRET.trim() : "";
  return fallback || null;
}

function getEncryptionKey(): Buffer | null {
  const raw = getRawSecret();
  if (!raw) return null;
  return createHash("sha256").update(raw).digest();
}

export function encryptGoogleToken(value: string): string | null {
  if (!value) return null;

  const key = getEncryptionKey();
  if (!key) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptGoogleToken(value: string): string | null {
  if (!value || !value.startsWith(ENC_PREFIX)) return null;

  const key = getEncryptionKey();
  if (!key) return null;

  const raw = value.slice(ENC_PREFIX.length);
  const [ivB64, authTagB64, dataB64] = raw.split(":");
  if (!ivB64 || !authTagB64 || !dataB64) return null;

  try {
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const data = Buffer.from(dataB64, "base64");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

export function hasGoogleTokenEncryptionKey(): boolean {
  return Boolean(getEncryptionKey());
}
