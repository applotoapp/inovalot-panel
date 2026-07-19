const DEFAULT_INSTANCE = "inovalot-panel";

export class EvolutionError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function evolutionConfig() {
  const baseUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new EvolutionError(
      "A integração com o WhatsApp ainda não foi configurada.",
      503,
    );
  }

  return {
    baseUrl,
    apiKey,
    instanceToken: process.env.EVOLUTION_INSTANCE_TOKEN || apiKey,
    provider: process.env.EVOLUTION_PROVIDER === "go" ? "go" : "v2",
    instance: process.env.EVOLUTION_INSTANCE_NAME || DEFAULT_INSTANCE,
  };
}

export function isEvolutionGo() {
  return evolutionConfig().provider === "go";
}

export async function evolutionRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
  admin = false,
  token?: string,
): Promise<T> {
  const { baseUrl, apiKey, instanceToken, provider } = evolutionConfig();
  const bodyIsJson = typeof init.body === "string";
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: provider === "go" && !admin ? token || instanceToken : apiKey,
      ...(bodyIsJson ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const reason =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `A Evolution respondeu com status ${response.status}.`;
    throw new EvolutionError(reason, response.status, payload);
  }

  return payload as T;
}

export function instanceName(requested?: string | null) {
  return requested || evolutionConfig().instance;
}

export function remoteNumber(remoteJid: string) {
  return remoteJid.split("@")[0].replace(/\D/g, "");
}
