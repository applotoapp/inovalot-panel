import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { evolutionRequest, isEvolutionGo, remoteNumber } from "@/lib/evolution";
import { normalizeMessages } from "@/lib/whatsapp-normalizers";
import { connectionByInstance } from "@/lib/agent-connections";
import { transcribeAudio } from "@/lib/groq-transcription";
import { canonicalWhatsappJid, whatsappJidAlias } from "@/lib/whatsapp-jids";
import {
  resolveWhatsappConversationJid,
  whatsappDeliveryJid,
} from "@/lib/whatsapp-identities";
import { generateAgentReply } from "@/lib/ai-reply";
import { synthesizeGeminiSpeech } from "@/lib/gemini-speech";
import { shouldReplyWithAudio } from "@/lib/tts-config";
import { splitAudioReply } from "@/lib/audio-reply";
import { normalizeContextMessageCount } from "@/lib/agent-runtime-config";
import {
  agentReplyWindowIsCurrent,
  finishAgentReplyWindow,
  scheduleAgentReplyWindow,
  waitAndClaimAgentReplyWindow,
} from "@/lib/agent-reply-window";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function webhookAuthorized(request: NextRequest) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true;
  return (
    request.headers.get("x-webhook-secret") === secret ||
    request.nextUrl.searchParams.get("token") === secret
  );
}

function messageContent(messageValue: unknown) {
  const message = object(messageValue);
  const extended = object(message.extendedTextMessage || message.ExtendedTextMessage);
  const image = object(message.imageMessage || message.ImageMessage);
  const video = object(message.videoMessage || message.VideoMessage);
  const document = object(message.documentMessage || message.DocumentMessage);
  const audio = object(message.audioMessage || message.AudioMessage);
  return (
    String(message.conversation || message.Conversation || "") ||
    String(extended.text || extended.Text || "") ||
    String(image.caption || image.Caption || "") ||
    String(video.caption || video.Caption || "") ||
    String(document.fileName || document.FileName || "") ||
    (Object.keys(audio).length ? "Áudio" : "") ||
    "Mensagem"
  );
}

function messageType(messageValue: unknown) {
  const message = object(messageValue);
  const key = Object.keys(message).find((name) => name.toLowerCase().endsWith("message"));
  return key?.replace(/message$/i, "").toLowerCase() || "text";
}

function isAudioPlaceholder(value: unknown) {
  const content = String(value || "").trim().toLocaleLowerCase("pt-BR");
  return !content || ["áudio", "audio", "mensagem"].includes(content);
}

function sentMessageId(value: unknown) {
  const root = object(value);
  const data = object(root.data);
  const info = object(data.Info || data.info);
  return String(info.ID || info.id || data.ID || data.id || root.ID || root.id || "");
}

async function sendAudioReply(
  instance: string,
  remoteJid: string,
  connectionToken: string | undefined,
  audio: NonNullable<Awaited<ReturnType<typeof synthesizeGeminiSpeech>>>,
) {
  if (isEvolutionGo()) {
    const deliveryJid = await whatsappDeliveryJid(instance, remoteJid);
    const form = new FormData();
    form.set("number", deliveryJid);
    form.set("formatJid", "false");
    form.set("type", "audio");
    form.set("caption", "");
    form.set("filename", audio.fileName);
    form.set("file", new Blob([audio.buffer], { type: audio.mimeType }), audio.fileName);
    return evolutionRequest(`/send/media`, { method: "POST", body: form }, false, connectionToken);
  }

  return evolutionRequest(`/message/sendMedia/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      number: remoteNumber(remoteJid),
      mediatype: "audio",
      mimetype: audio.mimeType,
      media: `data:${audio.mimeType};base64,${audio.buffer.toString("base64")}`,
      fileName: audio.fileName,
      caption: "",
    }),
  }, false, connectionToken);
}

async function sendTextReply(
  instance: string,
  remoteJid: string,
  connectionToken: string | undefined,
  text: string,
  delay = 1200,
) {
  const evolutionGo = isEvolutionGo();
  const deliveryJid = evolutionGo
    ? await whatsappDeliveryJid(instance, remoteJid)
    : remoteJid;
  return evolutionRequest(evolutionGo ? `/send/text` : `/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      number: evolutionGo ? deliveryJid : remoteNumber(remoteJid),
      text,
      delay,
      ...(evolutionGo ? { formatJid: false } : { linkPreview: true }),
    }),
  }, false, connectionToken);
}

async function storeAutomatedAudioReply(
  messageId: string,
  instance: string,
  remoteJid: string,
  reply: string,
  audio: NonNullable<Awaited<ReturnType<typeof synthesizeGeminiSpeech>>>,
  raw: unknown,
) {
  if (!messageId) return;
  await db()`
    insert into messages (message_id, instance_name, remote_jid, from_me, message_type,
                          content, mime_type, file_name, message_timestamp, status, raw)
    values (${messageId}, ${instance}, ${remoteJid}, true, 'audio',
            ${reply}, ${audio.mimeType}, ${audio.fileName}, now(), 'SENT', ${db().json(JSON.parse(JSON.stringify(raw)))})
    on conflict (message_id) do update set
      content = excluded.content,
      message_type = excluded.message_type,
      mime_type = coalesce(messages.mime_type, excluded.mime_type),
      file_name = coalesce(messages.file_name, excluded.file_name),
      status = excluded.status,
      raw = excluded.raw
  `;
}

function parseWebhookMessage(payload: Record<string, unknown>, event: string) {
  const data = object(payload.data);
  const key = object(data.key);
  const info = object(data.Info || data.info);
  const message = object(data.Message || data.message);
  const rawRemoteJid = String(key.remoteJid || info.Chat || info.chat || data.Chat || data.chat || "");
  const messageId = String(key.id || info.ID || info.id || data.ID || data.id || "");
  const rawTimestamp = info.Timestamp || info.timestamp || data.Timestamp || data.timestamp;
  const parsed = rawTimestamp ? new Date(String(rawTimestamp)) : new Date();
  const timestamp = Number.isNaN(parsed.getTime())
    ? new Date(Number(rawTimestamp || Date.now()) * (Number(rawTimestamp) < 2_000_000_000 ? 1000 : 1))
    : parsed;
  const media = object(
    message.imageMessage || message.ImageMessage ||
    message.videoMessage || message.VideoMessage ||
    message.documentMessage || message.DocumentMessage ||
    message.audioMessage || message.AudioMessage,
  );
  const extended = object(message.extendedTextMessage || message.ExtendedTextMessage);
  const context = object(extended.contextInfo || media.contextInfo || extended.ContextInfo || media.ContextInfo);
  const webhookBase64 = String(data.Base64 || data.base64 || message.Base64 || message.base64 || media.Base64 || media.base64 || "");
  const webhookMime = String(data.Mimetype || data.mimetype || message.mimetype || media.mimetype || media.mimeType || "application/octet-stream");
  const fromMe = Boolean(key.fromMe ?? info.IsFromMe ?? info.isFromMe ?? data.FromMe ?? event.includes("SEND"));
  const identity = {
    remoteJid: rawRemoteJid,
    fromMe,
    sender: info.Sender || info.sender || data.Sender || data.sender,
    senderAlt: info.SenderAlt || info.senderAlt || data.SenderAlt || data.senderAlt,
    recipientAlt: info.RecipientAlt || info.recipientAlt || data.RecipientAlt || data.recipientAlt,
  };
  const remoteJid = canonicalWhatsappJid(identity);
  return {
    messageId,
    remoteJid,
    jidAlias: whatsappJidAlias(identity),
    fromMe,
    pushName: String(data.PushName || data.pushName || info.PushName || info.pushName || ""),
    content: messageContent(message),
    type: messageType(message),
    mediaUrl: webhookBase64
      ? `data:${webhookMime};base64,${webhookBase64}`
      : String(message.mediaUrl || media.mediaUrl || media.url || "") || null,
    mimeType: String(message.mimetype || media.mimetype || media.mimeType || "") || null,
    fileName: String(media.fileName || "") || null,
    quotedId: String(context.stanzaId || context.StanzaID || context.stanzaID || "") || null,
    timestamp,
    status: fromMe ? "SENT" : "RECEIVED",
    raw: data,
  };
}

async function transcribeAndStoreAudio(
  instance: string,
  parsed: ReturnType<typeof parseWebhookMessage>,
) {
  const transcription = await transcribeAudio({
    instanceName: instance,
    mediaUrl: parsed.mediaUrl,
    mimeType: parsed.mimeType,
    fileName: parsed.fileName,
    raw: parsed.raw,
  });
  if (!transcription) return false;
  parsed.content = transcription;
  await db()`update messages set content = ${parsed.content} where message_id = ${parsed.messageId}`;
  return true;
}

export async function POST(request: NextRequest) {
  if (!webhookAuthorized(request)) {
    return NextResponse.json({ error: "Webhook não autorizado." }, { status: 401 });
  }

  try {
    const payload = object(await request.json());
    const event = String(payload.event || "UNKNOWN").toUpperCase().replace(/\./g, "_");
    const instance = String(payload.instance || payload.instanceName || process.env.EVOLUTION_INSTANCE_NAME || "inovalot-panel");
    await ensureSchema();
    await db()`
      insert into webhook_events (instance_name, event, payload)
      values (${instance}, ${event}, ${db().json(JSON.parse(JSON.stringify(payload)))})
    `;

    if (["RECEIPT", "MESSAGES_UPDATE"].includes(event)) {
      const receiptData = object(payload.data);
      const ids = (receiptData.MessageIDs || receiptData.messageIds || receiptData.ids || []) as unknown;
      if (Array.isArray(ids) && ids.length) {
        await db()`update messages set status = ${String(receiptData.Type || receiptData.state || "READ")} where message_id = any(${ids.map(String)})`;
      }
      return NextResponse.json({ received: true });
    }

    if (!["MESSAGES_UPSERT", "MESSAGE", "SENDMESSAGE", "SEND_MESSAGE"].includes(event)) {
      return NextResponse.json({ received: true });
    }

    const parsed = parseWebhookMessage(payload, event);
    parsed.remoteJid = await resolveWhatsappConversationJid(
      instance,
      parsed.remoteJid,
      parsed.jidAlias,
    );
    const { messageId, remoteJid, fromMe } = parsed;
    if (!messageId || !remoteJid || fromMe || remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") {
      if (messageId && remoteJid) {
        const [stored] = await db()`
          insert into messages (message_id, instance_name, remote_jid, from_me, push_name, message_type,
                                content, media_url, mime_type, file_name, quoted_id, message_timestamp, status, raw)
          values (${messageId}, ${instance}, ${remoteJid}, ${fromMe}, ${parsed.pushName}, ${parsed.type},
                  ${parsed.content}, ${parsed.mediaUrl}, ${parsed.mimeType}, ${parsed.fileName}, ${parsed.quotedId}, ${parsed.timestamp}, ${parsed.status}, ${db().json(JSON.parse(JSON.stringify(parsed.raw)))})
          on conflict (message_id) do update set
            status = excluded.status,
            raw = excluded.raw,
            media_url = coalesce(messages.media_url, excluded.media_url),
            mime_type = coalesce(messages.mime_type, excluded.mime_type),
            file_name = coalesce(messages.file_name, excluded.file_name)
          returning content
        `;
        if (
          fromMe &&
          parsed.type === "audio" &&
          isAudioPlaceholder(stored?.content)
        ) {
          await transcribeAndStoreAudio(instance, parsed);
        }
      }
      return NextResponse.json({ received: true, ignored: true });
    }

    const [inserted] = await db()`
      insert into messages (message_id, instance_name, remote_jid, from_me, push_name, message_type,
                            content, media_url, mime_type, file_name, quoted_id, message_timestamp, status, raw)
      values (${messageId}, ${instance}, ${remoteJid}, ${fromMe}, ${parsed.pushName}, ${parsed.type},
              ${parsed.content}, ${parsed.mediaUrl}, ${parsed.mimeType}, ${parsed.fileName}, ${parsed.quotedId}, ${parsed.timestamp}, ${parsed.status}, ${db().json(JSON.parse(JSON.stringify(parsed.raw)))})
      on conflict (message_id) do nothing
      returning message_id, created_at as "createdAt"
    `;
    if (!inserted) return NextResponse.json({ received: true, duplicate: true });

    const [conversationMetadata] = await db()`
      select agent_paused as "agentPaused"
      from conversation_meta
      where instance_name = ${instance} and remote_jid = ${remoteJid}
      limit 1
    `;
    if (conversationMetadata?.agentPaused === true) {
      console.info("[webhook] automação ignorada", {
        instance,
        reason: "conversation-paused",
        messageType: parsed.type,
      });
      return NextResponse.json({ received: true, automated: false, paused: true });
    }

    const [agent] = await db()`
      select id, provider, model, system_prompt as "systemPrompt", temperature,
             response_delay_seconds as "responseDelaySeconds",
             context_message_count as "contextMessageCount",
             audio_reply_mode as "audioReplyMode", tts_voice as "ttsVoice",
             tts_pace as "ttsPace", tts_style as "ttsStyle",
             tts_expressiveness as "ttsExpressiveness", tts_instructions as "ttsInstructions"
      from agents
      where enabled = true and (instance_name = ${instance} or instance_name is null)
      order by (instance_name = ${instance}) desc, updated_at desc
      limit 1
    `;
    if (!agent) {
      console.info("[webhook] automação ignorada", { instance, reason: "no-enabled-agent", messageType: parsed.type });
      return NextResponse.json({ received: true, automated: false });
    }

    const replyWindow = await scheduleAgentReplyWindow({
      instanceName: instance,
      remoteJid,
      messageId,
      messageCreatedAt: new Date(inserted.createdAt),
      responseDelaySeconds: agent.responseDelaySeconds,
    });
    if (!replyWindow) {
      return NextResponse.json({ received: true, automated: false, stacked: true, superseded: true });
    }

    try {
      if (parsed.type === "audio") {
        await transcribeAndStoreAudio(instance, parsed);
      }

      const claimed = await waitAndClaimAgentReplyWindow(replyWindow);
      if (!claimed) {
        return NextResponse.json({ received: true, automated: false, stacked: true, superseded: true });
      }

      const contextMessageCount = normalizeContextMessageCount(agent.contextMessageCount);
      console.info("[webhook] janela de resposta concluída", {
        instance,
        messageType: parsed.type,
        responseDelaySeconds: Number(agent.responseDelaySeconds),
        contextMessageCount,
        generation: replyWindow.generation,
      });
      const history = isEvolutionGo()
        ? await db()`
            select message_id as id, remote_jid as "remoteJid", from_me as "fromMe", content as text,
                   message_type as type, extract(epoch from message_timestamp)::bigint as timestamp,
                   status, media_url as "mediaUrl", mime_type as "mimeType",
                   file_name as "fileName", quoted_id as "quotedId", raw
            from messages where instance_name = ${instance} and remote_jid = ${remoteJid}
            order by message_timestamp desc, created_at desc
            limit ${contextMessageCount}
          `.then((rows) => [...rows].reverse() as ReturnType<typeof normalizeMessages>)
        : normalizeMessages(await evolutionRequest(
            `/chat/findMessages/${encodeURIComponent(instance)}`,
            { method: "POST", body: JSON.stringify({ where: { key: { remoteJid } } }) },
          )).slice(-contextMessageCount);
      const replyAsAudio = shouldReplyWithAudio(String(agent.audioReplyMode || "mirror"), parsed.type);
      const reply = await generateAgentReply(agent, history, instance, {
        forAudio: replyAsAudio,
        contextMessageCount,
      });
      if (!reply) {
        console.warn("[webhook] automação sem resposta", { instance, provider: String(agent.provider) });
        return NextResponse.json({ received: true, automated: false });
      }
      if (!await agentReplyWindowIsCurrent(replyWindow)) {
        return NextResponse.json({ received: true, automated: false, stacked: true, superseded: true });
      }

      const connection = await connectionByInstance(instance);
      if (replyAsAudio) {
        const preparedReply = splitAudioReply(reply);
        const audio = await synthesizeGeminiSpeech(preparedReply.spokenText, {
          voice: String(agent.ttsVoice || "Achird"),
          pace: String(agent.ttsPace || "normal"),
          style: String(agent.ttsStyle || "professional_warm"),
          expressiveness: String(agent.ttsExpressiveness || "balanced"),
          instructions: String(agent.ttsInstructions || ""),
        });
        if (audio) {
          if (!await agentReplyWindowIsCurrent(replyWindow)) {
            return NextResponse.json({ received: true, automated: false, stacked: true, superseded: true });
          }
          try {
            const sent = await sendAudioReply(instance, remoteJid, connection?.token, audio);
            try {
              await storeAutomatedAudioReply(
                sentMessageId(sent),
                instance,
                remoteJid,
                audio.transcript,
                audio,
                sent,
              );
            } catch (error) {
              console.error("[webhook] áudio enviado, mas não foi salvo no histórico", {
                instance,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            if (preparedReply.followUpText) {
              try {
                await sendTextReply(instance, remoteJid, connection?.token, preparedReply.followUpText, 500);
              } catch (error) {
                console.warn("[webhook] primeira tentativa de enviar o link falhou; tentando novamente", {
                  instance,
                  error: error instanceof Error ? error.message : String(error),
                });
                await sendTextReply(instance, remoteJid, connection?.token, preparedReply.followUpText);
              }
            }
            return NextResponse.json({
              received: true,
              automated: true,
              format: preparedReply.followUpText ? "audio+link" : "audio",
            });
          } catch (error) {
            console.error("[webhook] falha ao enviar resposta em áudio; usando texto", {
              instance,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      if (!await agentReplyWindowIsCurrent(replyWindow)) {
        return NextResponse.json({ received: true, automated: false, stacked: true, superseded: true });
      }
      await sendTextReply(instance, remoteJid, connection?.token, reply);
      return NextResponse.json({ received: true, automated: true, format: "text" });
    } finally {
      try {
        await finishAgentReplyWindow(replyWindow);
      } catch (error) {
        console.error("[webhook] falha ao finalizar janela de resposta", {
          instance,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    console.error("Erro no webhook da Evolution", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro no webhook." },
      { status: 500 },
    );
  }
}
