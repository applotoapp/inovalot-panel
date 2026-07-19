export type WhatsappIdentity = {
  remoteJid: unknown;
  fromMe: boolean;
  sender?: unknown;
  senderAlt?: unknown;
  recipientAlt?: unknown;
};

export type WhatsappJidAlias = {
  aliasJid: string;
  canonicalJid: string;
};

function jid(value: unknown) {
  return String(value || "").trim();
}

function phoneJid(value: unknown) {
  const candidate = jid(value);
  return candidate.endsWith("@s.whatsapp.net") ? candidate : "";
}

function lidJid(value: unknown) {
  const candidate = jid(value);
  return candidate.endsWith("@lid") ? candidate : "";
}

/**
 * Returns the two private-chat identities emitted by Evolution Go when both
 * are present in the same event. The LID must be retained for delivery while
 * the phone JID remains the stable key shown by the panel.
 */
export function whatsappJidAlias(identity: WhatsappIdentity): WhatsappJidAlias | null {
  const remoteJid = jid(identity.remoteJid);
  const isGroup = remoteJid.endsWith("@g.us");
  const aliasJid = isGroup
    ? [identity.senderAlt, identity.sender].map(lidJid).find(Boolean)
    : (identity.fromMe
        ? [identity.remoteJid]
        : [identity.remoteJid, identity.sender, identity.senderAlt])
      .map(lidJid)
      .find(Boolean);
  const canonicalJid = isGroup
    ? [identity.sender, identity.senderAlt].map(phoneJid).find(Boolean)
    : identity.fromMe
      ? [identity.recipientAlt, identity.remoteJid].map(phoneJid).find(Boolean)
      : [identity.remoteJid, identity.senderAlt, identity.sender].map(phoneJid).find(Boolean);

  return aliasJid && canonicalJid && aliasJid !== canonicalJid
    ? { aliasJid, canonicalJid }
    : null;
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
