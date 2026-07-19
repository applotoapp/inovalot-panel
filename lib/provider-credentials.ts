import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

export const providerDefinitions = [
  { id: "openai", name: "OpenAI", env: "OPENAI_API_KEY" },
  { id: "xai", name: "xAI (Grok)", env: "XAI_API_KEY" },
  { id: "openrouter", name: "OpenRouter", env: "OPENROUTER_API_KEY" },
  { id: "anthropic", name: "Anthropic", env: "ANTHROPIC_API_KEY" },
  { id: "google", name: "Google Gemini", env: "GOOGLE_AI_API_KEY" },
  { id: "groq", name: "Groq", env: "GROQ_API_KEY" },
] as const;

export type ProviderId = (typeof providerDefinitions)[number]["id"];

export async function getProviderApiKey(provider: string) {
  const definition = providerDefinitions.find((item) => item.id === provider);
  if (!definition) return null;
  const [credential] = await db()`
    select encrypted_key as "encryptedKey"
    from provider_credentials
    where provider = ${provider}
  `;
  if (credential?.encryptedKey) return decryptSecret(String(credential.encryptedKey));
  return process.env[definition.env] || null;
}

export async function providerCredentialStatuses() {
  const rows = await db()`select provider from provider_credentials`;
  const stored = new Set(rows.map((row) => String(row.provider)));
  return providerDefinitions.map((definition) => ({
    id: definition.id,
    name: definition.name,
    configured: stored.has(definition.id) || Boolean(process.env[definition.env]),
    source: stored.has(definition.id)
      ? "database" as const
      : process.env[definition.env]
        ? "environment" as const
        : null,
  }));
}

export async function saveProviderApiKey(provider: ProviderId, apiKey: string) {
  await db()`
    insert into provider_credentials (provider, encrypted_key)
    values (${provider}, ${encryptSecret(apiKey)})
    on conflict (provider) do update set
      encrypted_key = excluded.encrypted_key,
      updated_at = now()
  `;
}

export async function deleteProviderApiKey(provider: ProviderId) {
  await db()`delete from provider_credentials where provider = ${provider}`;
}
