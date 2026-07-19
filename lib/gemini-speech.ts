import { spawn } from "node:child_process";
import { getProviderApiKey } from "@/lib/provider-credentials";
import {
  defaultGeminiTtsExpressiveness,
  defaultGeminiTtsPace,
  defaultGeminiTtsStyle,
  defaultGeminiTtsVoice,
  geminiTtsExpressivenessDirections,
  geminiTtsExpressivenessLevels,
  geminiTtsPaces,
  geminiTtsStyleDirections,
  geminiTtsStyles,
  geminiTtsVoices,
  type GeminiTtsSettings,
} from "@/lib/tts-config";
import { splitAudioReply } from "@/lib/audio-reply";

const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const GEMINI_TTS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const PCM_SAMPLE_FORMAT = "s16le";
const FFMPEG_TIMEOUT_MS = 20_000;

export const geminiTtsTempoByPace = {
  slow: 0.88,
  normal: 1,
  fast: 1.12,
} as const satisfies Record<GeminiTtsSettings["pace"], number>;

type GeminiSpeechResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
      }>;
    };
  }>;
};

type GeminiTtsSettingsInput = {
  voice?: string;
  pace?: string;
  style?: string;
  expressiveness?: string;
  instructions?: string;
};

function pcmToWav(pcm: Buffer, sampleRate = PCM_SAMPLE_RATE) {
  const channels = PCM_CHANNELS;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

function adjustPcmTempo(pcm: Buffer, pace: GeminiTtsSettings["pace"]): Promise<Buffer> {
  const tempo = geminiTtsTempoByPace[pace];
  if (tempo === 1) return Promise.resolve(pcm);

  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-f", PCM_SAMPLE_FORMAT,
      "-ar", String(PCM_SAMPLE_RATE),
      "-ac", String(PCM_CHANNELS),
      "-i", "pipe:0",
      "-filter:a", `atempo=${tempo}`,
      "-f", PCM_SAMPLE_FORMAT,
      "-ar", String(PCM_SAMPLE_RATE),
      "-ac", String(PCM_CHANNELS),
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`FFmpeg excedeu ${FFMPEG_TIMEOUT_MS / 1000}s ao ajustar o ritmo.`)));
    }, FFMPEG_TIMEOUT_MS);
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => finish(() => {
      const adjusted = Buffer.concat(output);
      if (code !== 0 || !adjusted.length) {
        const details = Buffer.concat(errors).toString("utf8").trim().slice(0, 500);
        reject(new Error(`FFmpeg falhou ao ajustar o ritmo${details ? `: ${details}` : "."}`));
        return;
      }
      resolve(adjusted);
    }));

    child.stdin.on("error", (error) => finish(() => reject(error)));
    child.stdin.end(pcm);
  });
}

function speechText(value: string) {
  return splitAudioReply(value).spokenText
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, ""))
    .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function validValue<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

export function normalizeGeminiTtsSettings(
  requested: GeminiTtsSettingsInput = {},
): GeminiTtsSettings {
  return {
    voice: validValue(geminiTtsVoices, requested.voice, defaultGeminiTtsVoice),
    pace: validValue(geminiTtsPaces, requested.pace, defaultGeminiTtsPace),
    style: validValue(geminiTtsStyles, requested.style, defaultGeminiTtsStyle),
    expressiveness: validValue(
      geminiTtsExpressivenessLevels,
      requested.expressiveness,
      defaultGeminiTtsExpressiveness,
    ),
    instructions: String(requested.instructions || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600),
  };
}

export function geminiSpeechPrompt(transcript: string, requested: GeminiTtsSettingsInput = {}) {
  const settings = normalizeGeminiTtsSettings(requested);
  const directions = [
    "Fale em português brasileiro, como uma profissional de atendimento de um escritório de advocacia.",
    "Preserve a identidade, o timbre e o sotaque da voz selecionada do início ao fim.",
    "Use um ritmo natural e estável; a velocidade será ajustada posteriormente.",
    `Estilo e tom: ${geminiTtsStyleDirections[settings.style]}.`,
    `Expressividade: ${geminiTtsExpressivenessDirections[settings.expressiveness]}.`,
    settings.instructions ? `Orientações adicionais: ${settings.instructions}.` : "",
  ].filter(Boolean).join("\n");

  return `Sintetize a transcrição abaixo. Não leia estas instruções em voz alta, não acrescente comentários e não altere o texto.\n\nDIREÇÃO DE VOZ\n${directions}\n\nTRANSCRIÇÃO\n${transcript}`;
}

export async function synthesizeGeminiSpeech(
  text: string,
  requestedSettings: GeminiTtsSettingsInput = {},
) {
  const apiKey = await getProviderApiKey("google");
  if (!apiKey) {
    console.warn("[tts] chave do Google Gemini não configurada");
    return null;
  }

  const transcript = speechText(text);
  if (!transcript) return null;
  const settings = normalizeGeminiTtsSettings(requestedSettings);

  try {
    const response = await fetch(
      `${GEMINI_TTS_ENDPOINT}/${encodeURIComponent(GEMINI_TTS_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: geminiSpeechPrompt(transcript, settings),
            }],
          }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: settings.voice },
              },
            },
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(40_000),
      },
    );

    if (!response.ok) {
      console.error("[tts] Gemini recusou a síntese", {
        status: response.status,
        details: (await response.text()).slice(0, 500),
      });
      return null;
    }

    const payload = await response.json() as GeminiSpeechResponse;
    const encoded = payload.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
    if (!encoded) {
      console.error("[tts] Gemini não retornou áudio");
      return null;
    }

    const pcm = Buffer.from(encoded, "base64");
    if (!pcm.length) return null;
    const adjustedPcm = await adjustPcmTempo(pcm, settings.pace);
    console.info("[tts] áudio sintetizado", {
      model: GEMINI_TTS_MODEL,
      voice: settings.voice,
      pace: settings.pace,
      tempo: geminiTtsTempoByPace[settings.pace],
      style: settings.style,
      expressiveness: settings.expressiveness,
      hasAdditionalInstructions: Boolean(settings.instructions),
      transcriptLength: transcript.length,
      sourcePcmBytes: pcm.length,
      outputPcmBytes: adjustedPcm.length,
    });
    return {
      buffer: pcmToWav(adjustedPcm),
      mimeType: "audio/wav",
      fileName: `resposta-${Date.now()}.wav`,
      transcript,
    };
  } catch (error) {
    console.error("[tts] falha ao gerar áudio", {
      model: GEMINI_TTS_MODEL,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
