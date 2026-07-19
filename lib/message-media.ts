import { connectionByInstance } from "@/lib/agent-connections";
import { evolutionConfig, evolutionRequest } from "@/lib/evolution";

export type MessageMediaInput = {
  instanceName: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  raw: Record<string, unknown>;
};

export type DownloadedMessageMedia = {
  buffer: Buffer;
  mimeType: string;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function fromBase64(value: string, fallbackMime: string, maxBytes: number) {
  const comma = value.indexOf(",");
  const encoded = value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
  const declaredMime = value.startsWith("data:")
    ? value.slice(5, value.indexOf(";")).trim()
    : "";
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > maxBytes) return null;
  return { buffer, mimeType: declaredMime || fallbackMime || "application/octet-stream" };
}

export async function downloadMessageMedia(
  input: MessageMediaInput,
  maxBytes = 15 * 1024 * 1024,
): Promise<DownloadedMessageMedia | null> {
  const fallbackMime = input.mimeType || "application/octet-stream";
  if (input.mediaUrl?.startsWith("data:")) {
    return fromBase64(input.mediaUrl, fallbackMime, maxBytes);
  }

  const connection = await connectionByInstance(input.instanceName);
  if (input.mediaUrl && /^https?:\/\//i.test(input.mediaUrl)) {
    const mediaOrigin = new URL(input.mediaUrl).origin;
    const evolutionOrigin = new URL(evolutionConfig().baseUrl).origin;
    const response = await fetch(input.mediaUrl, {
      cache: "no-store",
      headers: mediaOrigin === evolutionOrigin && connection?.token
        ? { apikey: connection.token }
        : undefined,
      signal: AbortSignal.timeout(25_000),
    });
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length && buffer.length <= maxBytes) {
        return { buffer, mimeType: response.headers.get("content-type") || fallbackMime };
      }
    }
  }

  const rawMessage = object(input.raw.Message || input.raw.message);
  if (!Object.keys(rawMessage).length || !connection) return null;
  const downloaded = await evolutionRequest<unknown>("/message/downloadmedia", {
    method: "POST",
    body: JSON.stringify({ message: rawMessage }),
  }, false, connection.token);
  const root = object(downloaded);
  const data = root.data ?? downloaded;
  const payload = object(data);
  const encoded = typeof data === "string"
    ? data
    : String(payload.base64 || payload.Base64 || payload.media || payload.file || "");
  if (!encoded) return null;
  return fromBase64(
    encoded,
    String(payload.mimetype || payload.mimeType || fallbackMime),
    maxBytes,
  );
}
