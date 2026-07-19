import { getProviderApiKey } from "@/lib/provider-credentials";
import { downloadMessageMedia, type MessageMediaInput } from "@/lib/message-media";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function extensionFor(mimeType: string) {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("flac")) return "flac";
  return "ogg";
}

export async function transcribeAudio(input: MessageMediaInput) {
  const apiKey = await getProviderApiKey("groq");
  if (!apiKey) return null;

  try {
    const audio = await downloadMessageMedia(input, MAX_AUDIO_BYTES);
    if (!audio) return null;
    const form = new FormData();
    const fileName = input.fileName || `audio.${extensionFor(audio.mimeType)}`;
    form.set("file", new Blob([new Uint8Array(audio.buffer)], { type: audio.mimeType }), fileName);
    form.set("model", "whisper-large-v3-turbo");
    form.set("language", "pt");
    form.set("response_format", "json");
    form.set("temperature", "0");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      console.error("Falha na transcrição da Groq", response.status, (await response.text()).slice(0, 500));
      return null;
    }
    const payload = object(await response.json());
    return String(payload.text || "").trim() || null;
  } catch (error) {
    console.error("Não foi possível transcrever o áudio", error instanceof Error ? error.message : error);
    return null;
  }
}
