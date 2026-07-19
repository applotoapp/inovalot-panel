import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, ensureSchema } from "@/lib/db";
import { instanceSlug, newConnectionToken } from "@/lib/agent-connections";
import { encryptSecret } from "@/lib/secret-crypto";
import {
  defaultContextMessageCount,
  defaultResponseDelaySeconds,
  maxContextMessageCount,
  maxResponseDelaySeconds,
  minContextMessageCount,
  minResponseDelaySeconds,
} from "@/lib/agent-runtime-config";
import {
  audioReplyModes,
  defaultAudioReplyMode,
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

const agentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).default(""),
  provider: z.enum(["openai", "xai", "anthropic", "google", "openrouter"]).default("openai"),
  model: z.string().trim().min(2).max(120),
  systemPrompt: z.string().trim().min(20).max(40000),
  temperature: z.number().min(0).max(2).default(0.4),
  enabled: z.boolean().default(false),
  responseDelaySeconds: z.number().int().min(minResponseDelaySeconds).max(maxResponseDelaySeconds).default(defaultResponseDelaySeconds),
  contextMessageCount: z.number().int().min(minContextMessageCount).max(maxContextMessageCount).default(defaultContextMessageCount),
  audioReplyMode: z.enum(audioReplyModes).default(defaultAudioReplyMode),
  ttsVoice: z.enum(geminiTtsVoices).default(defaultGeminiTtsVoice),
  ttsPace: z.enum(geminiTtsPaces).default(defaultGeminiTtsPace),
  ttsStyle: z.enum(geminiTtsStyles).default(defaultGeminiTtsStyle),
  ttsExpressiveness: z.enum(geminiTtsExpressivenessLevels).default(defaultGeminiTtsExpressiveness),
  ttsInstructions: z.string().trim().max(600).default(""),
  instanceName: z.string().trim().max(80).nullable().optional(),
});

export async function GET() {
  try {
    await ensureSchema();
    const rows = await db()`
      select id, name, description, provider, model,
             system_prompt as "systemPrompt", temperature, enabled,
             response_delay_seconds as "responseDelaySeconds",
             context_message_count as "contextMessageCount",
             audio_reply_mode as "audioReplyMode", tts_voice as "ttsVoice",
             tts_pace as "ttsPace", tts_style as "ttsStyle",
             tts_expressiveness as "ttsExpressiveness", tts_instructions as "ttsInstructions",
             instance_name as "instanceName", (connection_token is not null) as "connectionConfigured",
             created_at as "createdAt", updated_at as "updatedAt"
      from agents order by updated_at desc
    `;
    return NextResponse.json({ data: rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar agentes." },
      { status: 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    const agent = agentSchema.parse(await request.json());
    await ensureSchema();
    const id = agent.id || crypto.randomUUID();
    const instance = agent.id
      ? agent.instanceName || instanceSlug(agent.name, id)
      : instanceSlug(agent.name, id);
    const encryptedToken = encryptSecret(newConnectionToken());
    const [row] = await db()`
      insert into agents (id, name, description, provider, model, system_prompt, temperature, enabled,
                          response_delay_seconds, context_message_count,
                          audio_reply_mode, tts_voice, tts_pace, tts_style, tts_expressiveness,
                          tts_instructions, instance_name, connection_token)
      values (${id}, ${agent.name}, ${agent.description}, ${agent.provider}, ${agent.model},
              ${agent.systemPrompt}, ${agent.temperature}, ${agent.enabled},
              ${agent.responseDelaySeconds}, ${agent.contextMessageCount}, ${agent.audioReplyMode},
              ${agent.ttsVoice}, ${agent.ttsPace}, ${agent.ttsStyle}, ${agent.ttsExpressiveness},
              ${agent.ttsInstructions}, ${instance}, ${encryptedToken})
      on conflict (id) do update set
        name = excluded.name,
        description = excluded.description,
        provider = excluded.provider,
        model = excluded.model,
        system_prompt = excluded.system_prompt,
        temperature = excluded.temperature,
        enabled = excluded.enabled,
        response_delay_seconds = excluded.response_delay_seconds,
        context_message_count = excluded.context_message_count,
        audio_reply_mode = excluded.audio_reply_mode,
        tts_voice = excluded.tts_voice,
        tts_pace = excluded.tts_pace,
        tts_style = excluded.tts_style,
        tts_expressiveness = excluded.tts_expressiveness,
        tts_instructions = excluded.tts_instructions,
        instance_name = agents.instance_name,
        connection_token = coalesce(agents.connection_token, excluded.connection_token),
        updated_at = now()
      returning id, name, description, provider, model, system_prompt as "systemPrompt",
                temperature, enabled, response_delay_seconds as "responseDelaySeconds",
                context_message_count as "contextMessageCount",
                audio_reply_mode as "audioReplyMode", tts_voice as "ttsVoice",
                tts_pace as "ttsPace", tts_style as "ttsStyle",
                tts_expressiveness as "ttsExpressiveness", tts_instructions as "ttsInstructions",
                instance_name as "instanceName",
                (connection_token is not null) as "connectionConfigured", updated_at as "updatedAt"
    `;
    return NextResponse.json({ data: row }, { status: agent.id ? 200 : 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Revise os campos do agente.", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar agente." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = z.string().uuid().parse(request.nextUrl.searchParams.get("id"));
    await ensureSchema();
    await db()`delete from agents where id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao remover agente." },
      { status: 400 },
    );
  }
}
