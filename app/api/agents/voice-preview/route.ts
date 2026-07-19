import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureSchema } from "@/lib/db";
import { synthesizeGeminiSpeech } from "@/lib/gemini-speech";
import {
  defaultGeminiTtsExpressiveness,
  defaultGeminiTtsPace,
  defaultGeminiTtsStyle,
  defaultGeminiTtsVoice,
  geminiTtsExpressivenessLevels,
  geminiTtsPaces,
  geminiTtsStyles,
  geminiTtsVoices,
} from "@/lib/tts-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const previewSchema = z.object({
  ttsVoice: z.enum(geminiTtsVoices).default(defaultGeminiTtsVoice),
  ttsPace: z.enum(geminiTtsPaces).default(defaultGeminiTtsPace),
  ttsStyle: z.enum(geminiTtsStyles).default(defaultGeminiTtsStyle),
  ttsExpressiveness: z.enum(geminiTtsExpressivenessLevels).default(defaultGeminiTtsExpressiveness),
  ttsInstructions: z.string().trim().max(600).default(""),
  text: z.string().trim().min(10).max(300).default(
    "Olá! Seja bem-vindo. Sou a assistente virtual do escritório e estou aqui para entender como posso ajudar.",
  ),
});

export async function POST(request: NextRequest) {
  try {
    const settings = previewSchema.parse(await request.json());
    await ensureSchema();
    const audio = await synthesizeGeminiSpeech(settings.text, {
      voice: settings.ttsVoice,
      pace: settings.ttsPace,
      style: settings.ttsStyle,
      expressiveness: settings.ttsExpressiveness,
      instructions: settings.ttsInstructions,
    });
    if (!audio) {
      return NextResponse.json(
        { error: "Não foi possível gerar a prévia. Verifique a chave do Google Gemini." },
        { status: 503 },
      );
    }

    return new NextResponse(new Uint8Array(audio.buffer), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${audio.fileName}"`,
        "Content-Type": audio.mimeType,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Revise as configurações da voz." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao gerar prévia da voz." },
      { status: 500 },
    );
  }
}
