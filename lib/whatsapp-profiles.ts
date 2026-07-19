import { connectionByInstance } from "@/lib/agent-connections";
import { evolutionRequest } from "@/lib/evolution";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function whatsappAvatarUrl(instanceName: string, remoteJid: string) {
  if (!remoteJid.endsWith("@s.whatsapp.net")) return null;
  const connection = await connectionByInstance(instanceName);
  if (!connection) return null;

  const response = await evolutionRequest<unknown>("/user/avatar", {
    method: "POST",
    body: JSON.stringify({ number: remoteJid, preview: false }),
    signal: AbortSignal.timeout(5_000),
  }, false, connection.token);
  const root = object(response);
  const data = object(root.data);
  const url = String(data.url || root.url || "");
  return /^https?:\/\//i.test(url) ? url : null;
}
