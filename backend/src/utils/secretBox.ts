import crypto from "node:crypto";
import { env } from "../config/env.js";

/**
 * Symmetric sealing for secrets at rest (hub agent API keys). Keys are
 * derived from JWT_SECRET, so rotating JWT_SECRET invalidates stored
 * secrets — users would need to re-enter their provider API keys.
 */

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = crypto.scryptSync(env.JWT_SECRET, "hub-agent-secrets", 32);
  }
  return cachedKey;
}

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function openSecret(sealed: string): string {
  const [version, ivB64, tagB64, dataB64] = sealed.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed sealed secret");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
