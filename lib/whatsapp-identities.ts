import { db } from "@/lib/db";
import type { WhatsappJidAlias } from "@/lib/whatsapp-jids";

function isPrivateJid(value: string) {
  return value.endsWith("@lid") || value.endsWith("@s.whatsapp.net");
}

async function mergeWhatsappConversation(
  instanceName: string,
  aliasJid: string,
  canonicalJid: string,
) {
  if (!aliasJid.endsWith("@lid") || !canonicalJid.endsWith("@s.whatsapp.net")) return;

  await db().begin(async (sql) => {
    await sql`
      insert into whatsapp_jid_aliases (instance_name, alias_jid, canonical_jid, updated_at)
      values (${instanceName}, ${aliasJid}, ${canonicalJid}, now())
      on conflict (instance_name, alias_jid) do update set
        canonical_jid = excluded.canonical_jid,
        updated_at = excluded.updated_at
    `;
    await sql`
      insert into conversation_meta (
        remote_jid, instance_name, assigned_agent_id, status, notes, tags,
        agent_paused, last_read_at, avatar_url, avatar_updated_at, updated_at
      )
      select ${canonicalJid}, instance_name, assigned_agent_id, status, notes, tags,
             agent_paused, last_read_at, avatar_url, avatar_updated_at, updated_at
      from conversation_meta
      where instance_name = ${instanceName} and remote_jid = ${aliasJid}
      on conflict (remote_jid, instance_name) do update set
        assigned_agent_id = coalesce(conversation_meta.assigned_agent_id, excluded.assigned_agent_id),
        status = case
          when conversation_meta.status = 'open' then excluded.status
          else conversation_meta.status
        end,
        notes = coalesce(nullif(conversation_meta.notes, ''), excluded.notes),
        tags = case
          when conversation_meta.tags = '[]'::jsonb then excluded.tags
          else conversation_meta.tags
        end,
        agent_paused = conversation_meta.agent_paused or excluded.agent_paused,
        last_read_at = greatest(conversation_meta.last_read_at, excluded.last_read_at),
        avatar_url = coalesce(conversation_meta.avatar_url, excluded.avatar_url),
        avatar_updated_at = greatest(conversation_meta.avatar_updated_at, excluded.avatar_updated_at),
        updated_at = greatest(conversation_meta.updated_at, excluded.updated_at)
    `;
    await sql`
      delete from conversation_meta
      where instance_name = ${instanceName} and remote_jid = ${aliasJid}
    `;
    // A newly discovered mapping generally follows a manual/outgoing message.
    // Cancel an obsolete alias window so it cannot produce a second response.
    await sql`
      delete from agent_reply_windows
      where instance_name = ${instanceName} and remote_jid = ${aliasJid}
    `;
    await sql`
      update messages
      set remote_jid = ${canonicalJid}
      where instance_name = ${instanceName} and remote_jid = ${aliasJid}
    `;
  });
}

export async function resolveWhatsappConversationJid(
  instanceName: string,
  remoteJid: string,
  discoveredAlias?: WhatsappJidAlias | null,
) {
  const candidate = remoteJid.trim();
  if (!isPrivateJid(candidate)) return candidate;

  if (discoveredAlias) {
    await mergeWhatsappConversation(
      instanceName,
      discoveredAlias.aliasJid,
      discoveredAlias.canonicalJid,
    );
    if (candidate === discoveredAlias.aliasJid) return discoveredAlias.canonicalJid;
  }
  if (!candidate.endsWith("@lid")) return candidate;

  const [mapping] = await db()`
    select canonical_jid as "canonicalJid"
    from whatsapp_jid_aliases
    where instance_name = ${instanceName} and alias_jid = ${candidate}
    limit 1
  `;
  return String(mapping?.canonicalJid || candidate);
}

export async function whatsappDeliveryJid(instanceName: string, conversationJid: string) {
  const candidate = conversationJid.trim();
  if (!candidate.endsWith("@s.whatsapp.net")) return candidate;

  const [mapping] = await db()`
    select alias_jid as "aliasJid"
    from whatsapp_jid_aliases
    where instance_name = ${instanceName} and canonical_jid = ${candidate}
    order by updated_at desc
    limit 1
  `;
  return String(mapping?.aliasJid || candidate);
}
