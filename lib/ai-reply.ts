import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { generateText, type ModelMessage, type UserContent } from "ai";
import mammoth from "mammoth";
import { getProviderApiKey } from "@/lib/provider-credentials";
import { normalizeContextMessageCount } from "@/lib/agent-runtime-config";
import { downloadMessageMedia } from "@/lib/message-media";
import type { ChatMessage } from "@/lib/whatsapp-normalizers";

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_DOCUMENT_CHARS = 40_000;
const MAX_MEDIA_MESSAGES = 4;

function normalizeDocumentText(value: string) {
  return value.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

async function extractDocumentText(buffer: Buffer, mimeType: string, fileName: string) {
  const lowerName = fileName.toLocaleLowerCase("pt-BR");
  if (mimeType.includes("pdf") || lowerName.endsWith(".pdf")) {
    // Keep PDF.js out of the webhook's module initialization. A failure while
    // loading or parsing one PDF must never prevent unrelated events from entering.
    const { extractText } = await import("unpdf");
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    return normalizeDocumentText(text).slice(0, MAX_DOCUMENT_CHARS);
  }
  if (
    mimeType.includes("wordprocessingml") ||
    lowerName.endsWith(".docx")
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return normalizeDocumentText(result.value).slice(0, MAX_DOCUMENT_CHARS);
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("xml") ||
    [".txt", ".csv", ".json", ".xml", ".html", ".md"].some((extension) => lowerName.endsWith(extension))
  ) {
    return normalizeDocumentText(buffer.toString("utf8")).slice(0, MAX_DOCUMENT_CHARS);
  }
  return "";
}

function attachmentIndexes(history: ChatMessage[]) {
  return new Set(history
    .map((message, index) => ({ index, type: message.type.toLowerCase(), fromMe: message.fromMe }))
    .filter((item) => !item.fromMe && ["image", "document"].includes(item.type))
    .slice(-MAX_MEDIA_MESSAGES)
    .map((item) => item.index));
}

async function userContent(message: ChatMessage, instanceName: string): Promise<UserContent> {
  const type = message.type.toLowerCase();
  if (!["image", "document"].includes(type)) return message.text;

  const media = await downloadMessageMedia({
    instanceName,
    mediaUrl: message.mediaUrl,
    mimeType: message.mimeType,
    fileName: message.fileName,
    raw: message.raw,
  }, MAX_ATTACHMENT_BYTES);
  const fileName = message.fileName || (type === "image" ? "imagem" : "documento");

  if (!media) {
    return `${message.text}\n\n[O anexo "${fileName}" não pôde ser baixado para análise.]`;
  }
  if (type === "image") {
    const caption = ["", "mensagem", "imagem"].includes(message.text.trim().toLocaleLowerCase("pt-BR"))
      ? `O usuário enviou a imagem "${fileName}". Analise o conteúdo visual antes de responder.`
      : message.text;
    return [
      { type: "text", text: caption },
      { type: "image", image: media.buffer, mediaType: media.mimeType },
    ];
  }

  try {
    const extracted = await extractDocumentText(media.buffer, media.mimeType, fileName);
    if (extracted) {
      return `${message.text}\n\n[Conteúdo extraído do documento "${fileName}"]\n${extracted}`;
    }
  } catch (error) {
    console.error("[ai] falha ao extrair documento", {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (media.mimeType.includes("pdf") || fileName.toLocaleLowerCase("pt-BR").endsWith(".pdf")) {
    return [
      { type: "text", text: `${message.text}\n\nAnalise diretamente o PDF "${fileName}" antes de responder.` },
      { type: "file", data: media.buffer, mediaType: "application/pdf", filename: fileName },
    ];
  }
  return `${message.text}\n\n[O arquivo "${fileName}" foi recebido, mas seu formato não possui extração de texto disponível.]`;
}

async function modelMessages(
  history: ChatMessage[],
  instanceName: string,
  contextMessageCount: number,
): Promise<ModelMessage[]> {
  const recent = history.slice(-contextMessageCount);
  const withMedia = attachmentIndexes(recent);
  return Promise.all(recent.map(async (message, index): Promise<ModelMessage> => {
    if (message.fromMe) return { role: "assistant", content: message.text };
    return {
      role: "user",
      content: withMedia.has(index) ? await userContent(message, instanceName) : message.text,
    };
  }));
}

function languageModel(provider: string, model: string, apiKey: string) {
  if (provider === "anthropic") return createAnthropic({ apiKey })(model);
  if (provider === "google") return createGoogleGenerativeAI({ apiKey })(model.replace(/^models\//, ""));
  if (provider === "xai") return createXai({ apiKey }).responses(model);
  if (provider === "openrouter") {
    return createOpenAICompatible({
      name: "openrouter",
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": "Inovalot Panel",
      },
    })(model);
  }
  if (provider === "openai") {
    return createOpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    })(model);
  }
  return null;
}

export async function generateAgentReply(
  agent: Record<string, unknown>,
  history: ChatMessage[],
  instanceName: string,
  options: { forAudio?: boolean; contextMessageCount?: number } = {},
) {
  const provider = String(agent.provider || "openai");
  const model = String(agent.model);
  const apiKey = await getProviderApiKey(provider);
  if (!apiKey) {
    console.warn("[webhook] automação sem chave de provedor", { provider });
    return null;
  }
  const selectedModel = languageModel(provider, model, apiKey);
  if (!selectedModel) return null;
  const contextMessageCount = normalizeContextMessageCount(
    options.contextMessageCount ?? agent.contextMessageCount,
  );

  try {
    const result = await generateText({
      model: selectedModel,
      system: `${String(agent.systemPrompt)}\n\nAo receber imagens ou documentos, analise diretamente o conteúdo fornecido. Não peça ao usuário para descrever um anexo que esteja disponível no contexto. Se um arquivo não puder ser lido, informe isso com clareza.${options.forAudio ? "\n\nEsta resposta será falada em áudio. Responda de forma natural e concisa, sem Markdown, listas ou elementos que soem artificiais quando lidos em voz alta. Quando for necessário fornecer um link, inclua a URL completa ao final da resposta; o sistema enviará o link separadamente e não o pronunciará no áudio." : ""}`,
      messages: await modelMessages(history, instanceName, contextMessageCount),
      temperature: Number(agent.temperature || 0.4),
      maxOutputTokens: options.forAudio ? 450 : 1200,
      timeout: 55_000,
    });
    return result.text.trim() || null;
  } catch (error) {
    console.error("Falha no provedor de IA", {
      provider,
      model,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
