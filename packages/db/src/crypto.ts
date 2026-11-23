// Operators' feed tokens are the only secrets the application stores. They are
// encrypted with AES-256-GCM under TOKEN_ENCRYPTION_KEY (32 bytes, written as 64 hex characters).

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  const bytes = raw && /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : null;
  if (!bytes || bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)");
  return bytes;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptToken(stored: string): string {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised token format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
