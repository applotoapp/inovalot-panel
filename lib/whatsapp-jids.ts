export type WhatsappIdentity = {
  remoteJid: unknown;
  fromMe: boolean;
  sender?: unknown;
  senderAlt?: unknown;
  recipientAlt?: unknown;
};

function jid(value: unknown) {
  return String(value || "").trim();
}

function phoneJid(value: unknown) {
  const candidate = jid(value);
  return candidate.endsWith("@s.whatsapp.net") ? candidate : "";
}

/**
 * Evolution Go can identify the same private chat by a WhatsApp LID in one
 * event and by the real phone JID in another. Prefer the alternate phone JID
 * so messages from both directions share one conversation key.
 */
export function canonicalWhatsappJid(identity: WhatsappIdentity) {
  const remoteJid = jid(identity.remoteJid);
  if (
    !remoteJid ||
    remoteJid.endsWith("@g.us") ||
    remoteJid === "status@broadcast"
  ) {
    return remoteJid;
  }

  const candidates = identity.fromMe
    ? [identity.recipientAlt, identity.remoteJid]
    : [identity.remoteJid, identity.sender, identity.senderAlt];

  return candidates.map(phoneJid).find(Boolean) || remoteJid;
}
