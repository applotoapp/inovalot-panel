import postgres from "postgres";

let client: ReturnType<typeof postgres> | undefined;
let initialized = false;

export function db() {
  const databaseUrl = process.env.DATABASE_URL;
  const host = process.env.PGHOST;
  if (!databaseUrl && !host) throw new Error("Conexão PostgreSQL não configurada.");
  client ||= host
    ? postgres({
        host,
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || "inovalot_panel",
        username: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "",
        max: 10,
        idle_timeout: 20,
      })
    : postgres(databaseUrl!, { max: 10, idle_timeout: 20 });
  return client;
}

export async function ensureSchema() {
  if (initialized) return;
  const sql = db();
  await sql`
    create table if not exists agents (
      id uuid primary key,
      name text not null,
      description text not null default '',
      provider text not null default 'openai',
      model text not null,
      system_prompt text not null,
      temperature real not null default 0.4,
      enabled boolean not null default false,
      audio_reply_mode text not null default 'mirror',
      tts_voice text not null default 'Achird',
      tts_pace text not null default 'normal',
      tts_style text not null default 'professional_warm',
      tts_expressiveness text not null default 'balanced',
      tts_instructions text not null default '',
      response_delay_seconds integer not null default 5 check (response_delay_seconds between 0 and 60),
      context_message_count integer not null default 16 check (context_message_count between 1 and 100),
      instance_name text,
      connection_token text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists conversation_meta (
      remote_jid text not null,
      instance_name text not null,
      assigned_agent_id uuid references agents(id) on delete set null,
      status text not null default 'open',
      notes text not null default '',
      tags jsonb not null default '[]'::jsonb,
      agent_paused boolean not null default false,
      last_read_at timestamptz,
      updated_at timestamptz not null default now(),
      primary key (remote_jid, instance_name)
    )
  `;
  await sql`
    create table if not exists webhook_events (
      id bigserial primary key,
      instance_name text not null,
      event text not null,
      payload jsonb not null,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists whatsapp_jid_aliases (
      instance_name text not null,
      alias_jid text not null,
      canonical_jid text not null,
      updated_at timestamptz not null default now(),
      primary key (instance_name, alias_jid)
    )
  `;
  await sql`
    create table if not exists processed_messages (
      message_id text primary key,
      instance_name text not null,
      processed_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists agent_reply_windows (
      instance_name text not null,
      remote_jid text not null,
      latest_message_id text not null,
      message_created_at timestamptz not null,
      generation bigint not null default 1 check (generation > 0),
      response_due_at timestamptz not null,
      claimed_generation bigint,
      claimed_at timestamptz,
      updated_at timestamptz not null default now(),
      primary key (instance_name, remote_jid)
    )
  `;
  await sql`
    create table if not exists provider_credentials (
      provider text primary key,
      encrypted_key text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists messages (
      message_id text primary key,
      instance_name text not null,
      remote_jid text not null,
      from_me boolean not null default false,
      push_name text not null default '',
      message_type text not null default 'text',
      content text not null default '',
      media_url text,
      mime_type text,
      file_name text,
      quoted_id text,
      message_timestamp timestamptz not null default now(),
      status text not null default 'PENDING',
      raw jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `;
  await sql`alter table conversation_meta add column if not exists last_read_at timestamptz`;
  await sql`alter table conversation_meta add column if not exists avatar_url text`;
  await sql`alter table conversation_meta add column if not exists avatar_updated_at timestamptz`;
  await sql`alter table conversation_meta add column if not exists agent_paused boolean not null default false`;
  await sql`alter table agents add column if not exists connection_token text`;
  await sql`alter table agents add column if not exists audio_reply_mode text not null default 'mirror'`;
  await sql`alter table agents add column if not exists tts_voice text not null default 'Achird'`;
  await sql`alter table agents add column if not exists tts_pace text not null default 'normal'`;
  await sql`alter table agents add column if not exists tts_style text not null default 'professional_warm'`;
  await sql`alter table agents add column if not exists tts_expressiveness text not null default 'balanced'`;
  await sql`alter table agents add column if not exists tts_instructions text not null default ''`;
  await sql`alter table agents add column if not exists response_delay_seconds integer not null default 5 check (response_delay_seconds between 0 and 60)`;
  await sql`alter table agents add column if not exists context_message_count integer not null default 16 check (context_message_count between 1 and 100)`;
  await sql`alter table messages add column if not exists mime_type text`;
  await sql`alter table messages add column if not exists quoted_id text`;
  await sql`
    update messages
    set content = regexp_replace(content, '^Transcrição do áudio:[[:space:]]*', '', 'i')
    where message_type = 'audio'
      and content ~* '^Transcrição do áudio:'
  `;
  await sql`
    update messages
    set push_name = coalesce(
      nullif(raw #>> '{Info,PushName}', ''),
      nullif(raw #>> '{info,pushName}', '')
    )
    where from_me = false
      and push_name = ''
      and coalesce(
        nullif(raw #>> '{Info,PushName}', ''),
        nullif(raw #>> '{info,pushName}', '')
      ) is not null
  `;
  // Build a durable LID -> phone map from historic raw events. A sent event
  // may already be stored by phone while its raw Info.Chat still carries the
  // LID, so mappings cannot be inferred from messages.remote_jid alone.
  await sql`
    with identities as (
      select instance_name, created_at,
        case
          when coalesce(raw #>> '{Info,Chat}', raw #>> '{info,chat}', '') like '%@lid'
            then coalesce(raw #>> '{Info,Chat}', raw #>> '{info,chat}')
          when remote_jid like '%@lid' then remote_jid
          when from_me = false and coalesce(raw #>> '{Info,SenderAlt}', raw #>> '{info,senderAlt}', '') like '%@lid'
            then coalesce(raw #>> '{Info,SenderAlt}', raw #>> '{info,senderAlt}')
          when from_me = false and coalesce(raw #>> '{Info,Sender}', raw #>> '{info,sender}', '') like '%@lid'
            then coalesce(raw #>> '{Info,Sender}', raw #>> '{info,sender}')
        end as alias_jid,
        case
          when remote_jid like '%@s.whatsapp.net' then remote_jid
          when from_me = true and coalesce(raw #>> '{Info,RecipientAlt}', raw #>> '{info,recipientAlt}', '') like '%@s.whatsapp.net'
            then coalesce(raw #>> '{Info,RecipientAlt}', raw #>> '{info,recipientAlt}')
          when from_me = false and coalesce(raw #>> '{Info,SenderAlt}', raw #>> '{info,senderAlt}', '') like '%@s.whatsapp.net'
            then coalesce(raw #>> '{Info,SenderAlt}', raw #>> '{info,senderAlt}')
          when from_me = false and coalesce(raw #>> '{Info,Sender}', raw #>> '{info,sender}', '') like '%@s.whatsapp.net'
            then coalesce(raw #>> '{Info,Sender}', raw #>> '{info,sender}')
        end as canonical_jid
      from messages
    ), mappings as (
      select distinct on (instance_name, alias_jid)
             instance_name, alias_jid, canonical_jid, created_at
      from identities
      where alias_jid like '%@lid'
        and canonical_jid like '%@s.whatsapp.net'
      order by instance_name, alias_jid, created_at desc
    )
    insert into whatsapp_jid_aliases (instance_name, alias_jid, canonical_jid, updated_at)
    select instance_name, alias_jid, canonical_jid, created_at
    from mappings
    on conflict (instance_name, alias_jid) do update set
      canonical_jid = excluded.canonical_jid,
      updated_at = greatest(whatsapp_jid_aliases.updated_at, excluded.updated_at)
  `;
  await sql`
    insert into conversation_meta (
      remote_jid, instance_name, assigned_agent_id, status, notes, tags,
      agent_paused, last_read_at, avatar_url, avatar_updated_at, updated_at
    )
    select aliases.canonical_jid, meta.instance_name, meta.assigned_agent_id,
           meta.status, meta.notes, meta.tags, meta.agent_paused,
           meta.last_read_at, meta.avatar_url, meta.avatar_updated_at, meta.updated_at
    from conversation_meta meta
    join whatsapp_jid_aliases aliases
      on aliases.instance_name = meta.instance_name
     and aliases.alias_jid = meta.remote_jid
    on conflict (remote_jid, instance_name) do update set
      assigned_agent_id = coalesce(conversation_meta.assigned_agent_id, excluded.assigned_agent_id),
      status = case when conversation_meta.status = 'open' then excluded.status else conversation_meta.status end,
      notes = coalesce(nullif(conversation_meta.notes, ''), excluded.notes),
      tags = case when conversation_meta.tags = '[]'::jsonb then excluded.tags else conversation_meta.tags end,
      agent_paused = conversation_meta.agent_paused or excluded.agent_paused,
      last_read_at = greatest(conversation_meta.last_read_at, excluded.last_read_at),
      avatar_url = coalesce(conversation_meta.avatar_url, excluded.avatar_url),
      avatar_updated_at = greatest(conversation_meta.avatar_updated_at, excluded.avatar_updated_at),
      updated_at = greatest(conversation_meta.updated_at, excluded.updated_at)
  `;
  await sql`
    delete from conversation_meta meta using whatsapp_jid_aliases aliases
    where meta.instance_name = aliases.instance_name
      and meta.remote_jid = aliases.alias_jid
  `;
  await sql`
    delete from agent_reply_windows reply_window using whatsapp_jid_aliases aliases
    where reply_window.instance_name = aliases.instance_name
      and reply_window.remote_jid = aliases.alias_jid
  `;
  await sql`
    update messages
    set remote_jid = aliases.canonical_jid
    from whatsapp_jid_aliases aliases
    where messages.instance_name = aliases.instance_name
      and messages.remote_jid = aliases.alias_jid
  `;
  await sql`create index if not exists messages_chat_time_idx on messages(instance_name, remote_jid, message_timestamp)`;
  await sql`create index if not exists webhook_events_instance_created_idx on webhook_events(instance_name, created_at desc)`;
  await sql`create index if not exists whatsapp_jid_aliases_canonical_idx on whatsapp_jid_aliases(instance_name, canonical_jid, updated_at desc)`;
  await sql`create unique index if not exists agents_instance_name_idx on agents(instance_name) where instance_name is not null`;
  initialized = true;
}
