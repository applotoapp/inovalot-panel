import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

function encryptionKey() {
  const secret = process.env.AI_CREDENTIALS_SECRET || process.env.WEBHOOK_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error("WEBHOOK_SECRET não configurado para proteger credenciais.");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string) {
  const [version, encodedIv, encodedTag, encodedValue] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedValue) {
    throw new Error("Formato de credencial inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
