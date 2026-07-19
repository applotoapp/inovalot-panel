export type Conversation = {
  id: string;
  instanceName: string;
  agentId?: string;
  agentName: string;
  name: string;
  phone: string;
  avatar?: string;
  lastMessage: string;
  lastMessageType?: string;
  lastMessageAt: number;
  unread: number;
  archived: boolean;
  pinned: boolean;
  isGroup: boolean;
  agentPaused: boolean;
};

export type ChatMessage = {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  text: string;
  type: string;
  timestamp: number;
  status?: string;
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
  quotedId?: string;
  raw: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function arrayPayload(payload: unknown, keys: string[]) {
  if (Array.isArray(payload)) return payload;
  let current: unknown = payload;
  for (const key of keys) {
    const value = record(current)[key];
    if (Array.isArray(value)) return value;
    if (value) current = value;
  }
  return [];
}

function messageText(messageValue: unknown) {
  const message = record(messageValue);
  const extended = record(message.extendedTextMessage);
  const image = record(message.imageMessage);
  const video = record(message.videoMessage);
  const document = record(message.documentMessage);
  const audio = record(message.audioMessage);
  const contact = record(message.contactMessage);
  const location = record(message.locationMessage);

  return (
    String(message.conversation || "") ||
    String(extended.text || "") ||
    String(image.caption || "") ||
    String(video.caption || "") ||
    String(document.fileName || "") ||
    (audio.url ? "Áudio" : "") ||
    String(contact.displayName || "") ||
    (location.degreesLatitude ? "Localização" : "") ||
    "Mensagem"
  );
}

function messageKind(messageValue: unknown) {
  const message = record(messageValue);
  const key = Object.keys(message).find((name) => name.endsWith("Message"));
  return key?.replace("Message", "") || "text";
}

export function normalizeChats(payload: unknown): Conversation[] {
  const chats = arrayPayload(payload, ["chats", "records", "data"]);

  return chats
    .map((item) => {
      const chat = record(item);
      const last = record(chat.lastMessage);
      const key = record(last.key);
      const remoteJid = String(chat.remoteJid || key.remoteJid || "");
      if (!remoteJid || remoteJid === "status@broadcast") return null;
      const phone = remoteJid.split("@")[0];
      const timestamp = Number(
        chat.updatedAt || last.messageTimestamp || chat.conversationTimestamp || 0,
      );

      return {
        id: remoteJid,
        instanceName: "",
        agentName: "WhatsApp",
        name: String(chat.name || chat.pushName || phone),
        phone,
        avatar: String(chat.profilePicUrl || chat.profilePictureUrl || "") || undefined,
        lastMessage: messageText(last.message || chat.lastMessage),
        lastMessageType: messageKind(last.message || chat.lastMessage),
        lastMessageAt: timestamp > 2_000_000_000 ? Math.floor(timestamp / 1000) : timestamp,
        unread: Number(chat.unreadCount || 0),
        archived: Boolean(chat.archived),
        pinned: Boolean(chat.pinned),
        isGroup: remoteJid.endsWith("@g.us"),
        agentPaused: false,
      } satisfies Conversation;
    })
    .filter((chat): chat is NonNullable<typeof chat> => chat !== null)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function normalizeMessages(payload: unknown): ChatMessage[] {
  const messages = arrayPayload(payload, ["messages", "records", "data"]);

  return messages
    .map((item) => {
      const raw = record(item);
      const key = record(raw.key);
      const message = record(raw.message);
      const context = record(record(message.extendedTextMessage).contextInfo);
      const media = record(
        message.imageMessage ||
          message.videoMessage ||
          message.documentMessage ||
          message.audioMessage,
      );

      return {
        id: String(key.id || raw.id || crypto.randomUUID()),
        remoteJid: String(key.remoteJid || raw.remoteJid || ""),
        fromMe: Boolean(key.fromMe ?? raw.fromMe),
        text: messageText(message),
        type: messageKind(message),
        timestamp: Number(raw.messageTimestamp || raw.timestamp || 0),
        status: String(raw.status || ""),
        mediaUrl: String(media.url || media.mediaUrl || "") || undefined,
        mimeType: String(media.mimetype || media.mimeType || "") || undefined,
        fileName: String(media.fileName || "") || undefined,
        quotedId: String(context.stanzaId || "") || undefined,
        raw,
      } satisfies ChatMessage;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}
