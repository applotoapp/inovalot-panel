import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  EvolutionError,
  evolutionConfig,
  evolutionRequest,
  instanceName,
  isEvolutionGo,
  remoteNumber,
} from "@/lib/evolution";
import { db, ensureSchema } from "@/lib/db";
import { agentConnection, connectionByInstance } from "@/lib/agent-connections";
import {
  normalizeChats,
  normalizeMessages,
} from "@/lib/whatsapp-normalizers";
import { whatsappAvatarUrl } from "@/lib/whatsapp-profiles";
import { downloadMessageMedia } from "@/lib/message-media";
import {
  resolveWhatsappConversationJid,
  whatsappDeliveryJid,
} from "@/lib/whatsapp-identities";

export const dynamic = "force-dynamic";

function evolutionInstances(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && "data" in payload) {
    const data = (payload as { data?: unknown }).data;
    return Array.isArray(data) ? data : [];
  }
  return [];
}

type StoredConversation = {
  id: string;
  instanceName: string;
  avatar?: string | null;
  avatarUpdatedAt?: number | string | null;
  isGroup: boolean;
  [key: string]: unknown;
};

async function refreshConversationAvatars(rows: StoredConversation[]) {
  const staleBefore = Date.now() / 1000 - 7 * 24 * 60 * 60;
  const pending = rows.filter((row) =>
    !row.isGroup &&
    Number(row.avatarUpdatedAt || 0) < staleBefore,
  ).slice(0, 12);

  await Promise.allSettled(pending.map(async (row) => {
    const avatar = await whatsappAvatarUrl(row.instanceName, row.id);
    await db()`
      insert into conversation_meta (remote_jid, instance_name, avatar_url, avatar_updated_at)
      values (${row.id}, ${row.instanceName}, ${avatar}, now())
      on conflict (remote_jid, instance_name) do update set
        avatar_url = excluded.avatar_url,
        avatar_updated_at = excluded.avatar_updated_at,
        updated_at = now()
    `;
    row.avatar = avatar;
    row.avatarUpdatedAt = Math.floor(Date.now() / 1000);
  }));

  return rows;
}

function failure(error: unknown) {
  if (error instanceof EvolutionError) {
    console.warn("[whatsapp] Evolution request failed", {
      status: error.status,
      message: error.message,
    });
    // Do not forward the upstream Basic Auth challenge to the browser. A 401/403
    // from this same-origin route makes Chrome reopen the site's login dialog.
    const status = error.status === 401 || error.status === 403 ? 502 : error.status;
    return NextResponse.json(
      { error: error.message, details: error.details },
      { status },
    );
  }
  console.error(error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Erro inesperado." },
    { status: 500 },
  );
}

function mediaFileName(value: unknown, mimeType: string) {
  const provided = String(value || "").replace(/[\r\n]/g, "").trim();
  if (provided) return provided;
  const extension = mimeType.startsWith("image/")
    ? mimeType.split("/")[1]?.split(";")[0] || "jpg"
    : mimeType.startsWith("audio/")
      ? mimeType.split("/")[1]?.split(";")[0] || "ogg"
      : mimeType.startsWith("video/")
        ? mimeType.split("/")[1]?.split(";")[0] || "mp4"
        : "bin";
  return `midia.${extension}`;
}

function binaryMediaResponse(
  request: NextRequest,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
) {
  const total = buffer.length;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400, immutable",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Content-Type": mimeType,
    "X-Content-Type-Options": "nosniff",
  });
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    headers.set("Content-Length", String(total));
    return new NextResponse(new Uint8Array(buffer), { headers });
  }

  const suffixLength = range[1] ? 0 : Number(range[2] || 0);
  const start = range[1] ? Number(range[1]) : Math.max(total - suffixLength, 0);
  const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= total) {
    headers.set("Content-Range", `bytes */${total}`);
    return new NextResponse(null, { status: 416, headers });
  }

  const partial = buffer.subarray(start, end + 1);
  headers.set("Content-Length", String(partial.length));
  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  return new NextResponse(new Uint8Array(partial), { status: 206, headers });
}

async function requestScope(agentId?: string | null, requestedInstance?: string | null) {
  if (agentId) return agentConnection(agentId);
  const resolvedInstance = instanceName(requestedInstance);
  const linked = await connectionByInstance(resolvedInstance);
  if (linked) return linked;
  return {
    agentId: "",
    agentName: "WhatsApp",
    instanceName: resolvedInstance,
    token: evolutionConfig().instanceToken,
  };
}

export async function GET(request: NextRequest) {
  const op = request.nextUrl.searchParams.get("op") || "status";

  try {
    const agentId = request.nextUrl.searchParams.get("agentId");
    const requestedInstance = request.nextUrl.searchParams.get("instance");
    if (op === "instances") {
      const data = isEvolutionGo()
        ? await evolutionRequest(`/instance/all`, {}, true)
        : await evolutionRequest(`/instance/fetchInstances`);
      return NextResponse.json({ data });
    }
    const scope = await requestScope(agentId, requestedInstance);
    const instance = scope.instanceName;
    if (op === "media") {
      const messageId = z.string().min(1).max(200).parse(
        request.nextUrl.searchParams.get("messageId"),
      );
      await ensureSchema();
      const [message] = await db()`
        select media_url as "mediaUrl", mime_type as "mimeType",
               file_name as "fileName", raw
        from messages
        where instance_name = ${instance} and message_id = ${messageId}
        limit 1
      `;
      if (!message) {
        return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
      }
      const media = await downloadMessageMedia({
        instanceName: instance,
        mediaUrl: String(message.mediaUrl || "") || null,
        mimeType: String(message.mimeType || "") || null,
        fileName: String(message.fileName || "") || null,
        raw: message.raw && typeof message.raw === "object"
          ? message.raw as Record<string, unknown>
          : {},
      });
      if (!media) {
        return NextResponse.json({ error: "O conteúdo desta mídia não está disponível." }, { status: 404 });
      }
      return binaryMediaResponse(
        request,
        media.buffer,
        media.mimeType,
        mediaFileName(message.fileName, media.mimeType),
      );
    }
    if (op === "status") {
      if (isEvolutionGo()) {
        const instances = await evolutionRequest(`/instance/all`, {}, true);
        const exists = evolutionInstances(instances).some((candidate) =>
          candidate && typeof candidate === "object" &&
          (candidate as { name?: unknown }).name === instance,
        );
        if (!exists) {
          return NextResponse.json({
            data: { state: "closed", connected: false, instanceExists: false },
            instance, agentId: scope.agentId,
          });
        }
      }
      const data = isEvolutionGo()
        ? await evolutionRequest(`/instance/status`, {}, false, scope.token)
        : await evolutionRequest(`/instance/connectionState/${encodeURIComponent(instance)}`);
      return NextResponse.json({ data, instance, agentId: scope.agentId });
    }
    if (op === "connect") {
      const data = isEvolutionGo()
        ? await (async () => {
            await evolutionRequest(`/instance/connect`, {
              method: "POST",
              body: JSON.stringify({
                webhookUrl:
                  process.env.EVOLUTION_WEBHOOK_URL ||
                  `${process.env.APP_URL || "http://crmapp:3000"}/api/webhooks/evolution?token=${encodeURIComponent(process.env.WEBHOOK_SECRET || "")}`,
                subscribe: ["ALL"],
                immediate: true,
              }),
            }, false, scope.token);
            return evolutionRequest(`/instance/qr`, {}, false, scope.token);
          })()
        : await evolutionRequest(`/instance/connect/${encodeURIComponent(instance)}`);
      return NextResponse.json({ data, instance, agentId: scope.agentId });
    }
    if (op === "qr") {
      const data = isEvolutionGo()
        ? await evolutionRequest(`/instance/qr`, {}, false, scope.token)
        : await evolutionRequest(`/instance/connect/${encodeURIComponent(instance)}`);
      return NextResponse.json({ data, instance, agentId: scope.agentId });
    }
    if (op === "chats") {
      if (isEvolutionGo()) {
        await ensureSchema();
        const filterInstance = agentId || requestedInstance ? instance : null;
        const rows = await db()`
          with latest as (
            select distinct on (m.instance_name, m.remote_jid) m.*
            from messages m
            where (${filterInstance}::text is null or m.instance_name = ${filterInstance})
              and m.remote_jid <> 'status@broadcast'
            order by m.instance_name, m.remote_jid, m.message_timestamp desc
          )
          select
            latest.remote_jid as id,
            latest.instance_name as "instanceName",
            linked_agent.id as "agentId",
            coalesce(linked_agent.name, latest.instance_name) as "agentName",
            coalesce(nullif(contact_name.push_name, ''), split_part(latest.remote_jid, '@', 1)) as name,
            split_part(latest.remote_jid, '@', 1) as phone,
            meta.avatar_url as avatar,
            extract(epoch from meta.avatar_updated_at)::bigint as "avatarUpdatedAt",
            latest.content as "lastMessage",
            latest.message_type as "lastMessageType",
            extract(epoch from latest.message_timestamp)::bigint as "lastMessageAt",
            (select count(*)::int from messages unread_message
              where unread_message.instance_name = latest.instance_name
                and unread_message.remote_jid = latest.remote_jid
                and unread_message.from_me = false
                and unread_message.message_timestamp > coalesce(meta.last_read_at, 'epoch'::timestamptz)) as unread,
            (coalesce(meta.status, 'open') = 'archived') as archived,
            coalesce(meta.agent_paused, false) as "agentPaused",
            false as pinned,
            (latest.remote_jid like '%@g.us') as "isGroup"
          from latest
          left join conversation_meta meta
            on meta.instance_name = latest.instance_name and meta.remote_jid = latest.remote_jid
          left join lateral (
            select contact_message.push_name
            from messages contact_message
            where contact_message.instance_name = latest.instance_name
              and contact_message.remote_jid = latest.remote_jid
              and contact_message.from_me = false
              and contact_message.push_name <> ''
            order by contact_message.message_timestamp desc
            limit 1
          ) contact_name on true
          left join agents linked_agent on linked_agent.instance_name = latest.instance_name
          where coalesce(meta.status, 'open') <> 'archived'
        `;
        const sorted = [...rows].sort((a, b) => Number(b.lastMessageAt) - Number(a.lastMessageAt)) as StoredConversation[];
        await refreshConversationAvatars(sorted);
        return NextResponse.json({ data: sorted, instance: filterInstance });
      }
      await ensureSchema();
      const data = await evolutionRequest(
        `/chat/findChats/${encodeURIComponent(instance)}`,
        { method: "POST", body: JSON.stringify({}) },
      );
      const chats = normalizeChats(data);
      const metadata = await db()`
        select remote_jid as "remoteJid", agent_paused as "agentPaused"
        from conversation_meta
        where instance_name = ${instance}
      `;
      const pausedByJid = new Map(metadata.map((row) => [String(row.remoteJid), Boolean(row.agentPaused)]));
      return NextResponse.json({
        data: chats.map((chat) => ({
          ...chat,
          instanceName: instance,
          agentId: scope.agentId || undefined,
          agentName: scope.agentName,
          agentPaused: pausedByJid.get(chat.id) || false,
        })),
        raw: data,
      });
    }
    if (op === "messages") {
      let remoteJid = z.string().min(3).parse(
        request.nextUrl.searchParams.get("remoteJid"),
      );
      if (isEvolutionGo()) {
        await ensureSchema();
        remoteJid = await resolveWhatsappConversationJid(instance, remoteJid);
        const rows = await db()`
          select message_id as id, remote_jid as "remoteJid", from_me as "fromMe",
                 content as text, message_type as type,
                 extract(epoch from message_timestamp)::bigint as timestamp,
                 status, (media_url is not null and media_url <> '') as "hasMedia",
                 mime_type as "mimeType", file_name as "fileName", quoted_id as "quotedId"
          from messages
          where instance_name = ${instance} and remote_jid = ${remoteJid}
          order by message_timestamp asc
          limit 500
        `;
        const data = rows.map(({ hasMedia, ...message }) => ({
          ...message,
          mediaUrl: hasMedia
            ? `/api/whatsapp?op=media&messageId=${encodeURIComponent(String(message.id))}&instance=${encodeURIComponent(instance)}${scope.agentId ? `&agentId=${encodeURIComponent(scope.agentId)}` : ""}`
            : undefined,
          raw: {},
        }));
        return NextResponse.json({ data, instance, agentId: scope.agentId });
      }
      const data = await evolutionRequest(
        `/chat/findMessages/${encodeURIComponent(instance)}`,
        {
          method: "POST",
          body: JSON.stringify({ where: { key: { remoteJid } } }),
        },
      );
      return NextResponse.json({ data: normalizeMessages(data), raw: data });
    }
    return NextResponse.json({ error: "Operação inválida." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-instance"),
    agentId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("disconnect"),
    agentId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("set-agent-paused"),
    agentId: z.string().uuid().optional(),
    instance: z.string().optional(),
    remoteJid: z.string().min(3),
    paused: z.boolean(),
  }),
  z.object({
    action: z.literal("send-text"),
    agentId: z.string().uuid().optional(),
    instance: z.string().optional(),
    remoteJid: z.string().min(3),
    text: z.string().trim().min(1).max(65000),
    quotedId: z.string().optional(),
  }),
  z.object({
    action: z.literal("send-media"),
    agentId: z.string().uuid().optional(),
    instance: z.string().optional(),
    remoteJid: z.string().min(3),
    media: z.string().min(10),
    mediaType: z.enum(["image", "video", "document", "audio"]),
    mimeType: z.string().min(3),
    fileName: z.string().max(240).optional(),
    caption: z.string().max(5000).optional(),
  }),
  z.object({
    action: z.enum(["mark-read", "mark-unread"]),
    agentId: z.string().uuid().optional(),
    instance: z.string().optional(),
    remoteJid: z.string().min(3),
    messageId: z.string().min(1),
    fromMe: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("archive"),
    agentId: z.string().uuid().optional(),
    instance: z.string().optional(),
    remoteJid: z.string().min(3),
    messageId: z.string().min(1),
    archive: z.boolean(),
  }),
  z.object({
    action: z.literal("reaction"),
    agentId: z.string().uuid().optional(),
    instance: z.string().optional(),
    remoteJid: z.string().min(3),
    messageId: z.string().min(1),
    fromMe: z.boolean(),
    reaction: z.string().max(8),
  }),
  z.object({
    action: z.literal("delete-message"),
    agentId: z.string().uuid().optional(),
    instance: z.string().optional(),
    remoteJid: z.string().min(3),
    messageId: z.string().min(1),
    fromMe: z.boolean(),
  }),
  z.object({
    action: z.literal("presence"),
    agentId: z.string().uuid().optional(),
    instance: z.string().optional(),
    remoteJid: z.string().min(3),
    presence: z.enum(["composing", "recording", "paused"]),
  }),
]);

export async function POST(request: NextRequest) {
  try {
    const body = actionSchema.parse(await request.json());
    const scope = await requestScope("agentId" in body ? body.agentId : undefined, "instance" in body ? body.instance : undefined);
    const instance = scope.instanceName;
    const scopedRequest = <T = unknown>(path: string, init: RequestInit = {}) =>
      evolutionRequest<T>(path, init, false, scope.token);

    if (body.action === "create-instance") {
      if (isEvolutionGo()) {
        const instances = evolutionInstances(
          await evolutionRequest(`/instance/all`, {}, true),
        );
        const alreadyExists = instances.some((candidate) =>
          candidate && typeof candidate === "object" &&
          (candidate as { name?: unknown }).name === instance,
        );
        if (alreadyExists) {
          return NextResponse.json({
            data: { name: instance, alreadyExists: true },
          });
        }
        const data = await evolutionRequest(`/instance/create`, {
          method: "POST",
          body: JSON.stringify({
            name: instance,
            token: scope.token,
            advancedSettings: {
              alwaysOnline: false,
              readMessages: false,
              ignoreGroups: false,
              ignoreStatus: true,
            },
          }),
        }, true);
        return NextResponse.json({ data }, { status: 201 });
      }
      const data = await evolutionRequest(`/instance/create`, {
        method: "POST",
        body: JSON.stringify({
          instanceName: instance,
          integration: "WHATSAPP-BAILEYS",
          qrcode: true,
          groupsIgnore: true,
          alwaysOnline: false,
          readMessages: false,
          readStatus: false,
          syncFullHistory: true,
        }),
      });
      return NextResponse.json({ data }, { status: 201 });
    }

    if (body.action === "disconnect") {
      const data = await scopedRequest(
        isEvolutionGo()
          ? "/instance/logout"
          : `/instance/logout/${encodeURIComponent(instance)}`,
        { method: "DELETE" },
      );
      return NextResponse.json({ data, instance, agentId: scope.agentId });
    }
    const evolutionGo = isEvolutionGo();
    if (evolutionGo) await ensureSchema();
    const conversationJid = evolutionGo
      ? await resolveWhatsappConversationJid(instance, body.remoteJid)
      : body.remoteJid;
    const deliveryJid = evolutionGo
      ? await whatsappDeliveryJid(instance, conversationJid)
      : conversationJid;
    if (body.action === "set-agent-paused") {
      await ensureSchema();
      const [metadata] = await db().begin(async (sql) => {
        const rows = await sql`
          insert into conversation_meta (remote_jid, instance_name, agent_paused)
          values (${conversationJid}, ${instance}, ${body.paused})
          on conflict (remote_jid, instance_name)
          do update set agent_paused = excluded.agent_paused, updated_at = now()
          returning agent_paused as "agentPaused"
        `;
        if (body.paused) {
          await sql`
            delete from agent_reply_windows
            where instance_name = ${instance} and remote_jid = ${conversationJid}
          `;
        }
        return rows;
      });
      return NextResponse.json({
        data: { agentPaused: Boolean(metadata.agentPaused) },
        instance,
        agentId: scope.agentId,
      });
    }
    const number = evolutionGo ? deliveryJid : remoteNumber(conversationJid);
    let data: unknown;
    if (body.action === "send-text") {
      data = await scopedRequest(isEvolutionGo() ? `/send/text` : `/message/sendText/${encodeURIComponent(instance)}`, {
        method: "POST",
        body: JSON.stringify({
          number,
          text: body.text,
          ...(evolutionGo ? { formatJid: false } : {}),
          ...(body.quotedId
            ? isEvolutionGo()
              ? { quoted: { messageId: body.quotedId } }
              : { quoted: { key: { id: body.quotedId } } }
            : {}),
          ...(!evolutionGo ? { linkPreview: true } : {}),
        }),
      });
    } else if (body.action === "send-media") {
      if (isEvolutionGo()) {
        const [, base64 = body.media] = body.media.split(",", 2);
        const form = new FormData();
        form.set("number", number);
        form.set("formatJid", "false");
        form.set("type", body.mediaType);
        form.set("caption", body.caption || "");
        form.set("filename", body.fileName || "arquivo");
        form.set("file", new Blob([Buffer.from(base64, "base64")], { type: body.mimeType }), body.fileName || "arquivo");
        data = await scopedRequest(`/send/media`, { method: "POST", body: form });
      } else {
        data = await scopedRequest(`/message/sendMedia/${encodeURIComponent(instance)}`, {
          method: "POST",
          body: JSON.stringify({ number, mediatype: body.mediaType, mimetype: body.mimeType, media: body.media, fileName: body.fileName, caption: body.caption }),
        });
      }
    } else if (body.action === "reaction") {
      data = await scopedRequest(isEvolutionGo() ? `/message/react` : `/message/sendReaction/${encodeURIComponent(instance)}`, {
        method: "POST",
        body: JSON.stringify(isEvolutionGo()
          ? { number: deliveryJid, fromMe: body.fromMe, id: body.messageId, reaction: body.reaction }
          : { key: { remoteJid: conversationJid, fromMe: body.fromMe, id: body.messageId }, reaction: body.reaction }),
      });
    } else if (body.action === "delete-message") {
      data = await scopedRequest(isEvolutionGo() ? `/message/delete` : `/chat/deleteMessageForEveryone/${encodeURIComponent(instance)}`, {
        method: isEvolutionGo() ? "POST" : "DELETE",
        body: JSON.stringify(isEvolutionGo()
          ? { chat: deliveryJid, messageId: body.messageId }
          : { id: body.messageId, remoteJid: conversationJid, fromMe: body.fromMe }),
      });
    } else if (body.action === "archive") {
      data = await scopedRequest(isEvolutionGo()
        ? body.archive ? `/chat/archive` : `/chat/unarchive`
        : `/chat/archiveChat/${encodeURIComponent(instance)}`, {
        method: "POST",
        body: JSON.stringify(isEvolutionGo() ? { chat: deliveryJid } : {
          lastMessage: { key: { id: body.messageId, remoteJid: conversationJid, fromMe: false } },
          archive: body.archive,
        }),
      });
    } else if (body.action === "presence") {
      data = await scopedRequest(isEvolutionGo() ? `/message/presence` : `/chat/sendPresence/${encodeURIComponent(instance)}`, {
        method: "POST",
        body: JSON.stringify(isEvolutionGo()
          ? { number, formatJid: false, state: body.presence, isAudio: body.presence === "recording", delay: 1200 }
          : { number, presence: body.presence, delay: 1200 }),
      });
    } else {
      if (isEvolutionGo()) {
        if (body.action === "mark-unread") throw new EvolutionError("O Evolution Go ainda não oferece marcar como não lida.", 501);
        data = await scopedRequest(`/message/markread`, { method: "POST", body: JSON.stringify({ id: [body.messageId], number }) });
      } else {
        const endpoint = body.action === "mark-read" ? "markMessageAsRead" : "markMessageAsUnread";
        data = await scopedRequest(`/chat/${endpoint}/${encodeURIComponent(instance)}`, {
          method: "POST",
          body: JSON.stringify({ readMessages: [{ remoteJid: body.remoteJid, fromMe: body.fromMe, id: body.messageId }] }),
        });
      }
    }

    if (body.action === "mark-read") {
      await ensureSchema();
      await db()`
        insert into conversation_meta (remote_jid, instance_name, last_read_at)
        values (${conversationJid}, ${instance}, now())
        on conflict (remote_jid, instance_name)
        do update set last_read_at = excluded.last_read_at, updated_at = now()
      `;
    } else if (body.action === "archive") {
      await ensureSchema();
      await db()`
        insert into conversation_meta (remote_jid, instance_name, status)
        values (${conversationJid}, ${instance}, ${body.archive ? "archived" : "open"})
        on conflict (remote_jid, instance_name)
        do update set status = excluded.status, updated_at = now()
      `;
    }

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Dados inválidos.", issues: error.issues }, { status: 400 });
    }
    return failure(error);
  }
}
