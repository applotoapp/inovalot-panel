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
  // Evolution Go may emit an internal @lid chat for outgoing messages and the
  // real phone JID for replies. Merge historic aliases before listing chats.
  await sql`
    with mappings as (
      select distinct instance_name, remote_jid as alias_jid,
        case
          when from_me then coalesce(
            nullif(raw #>> '{Info,RecipientAlt}', ''),
            nullif(raw #>> '{info,recipientAlt}', '')
          )
          else coalesce(
            nullif(raw #>> '{Info,SenderAlt}', ''),
            nullif(raw #>> '{info,senderAlt}', ''),
            nullif(raw #>> '{Info,Sender}', ''),
            nullif(raw #>> '{info,sender}', '')
          )
        end as canonical_jid
      from messages
      where remote_jid like '%@lid'
    ), valid_mappings as (
      select * from mappings
      where canonical_jid like '%@s.whatsapp.net' and canonical_jid <> alias_jid
    )
    insert into conversation_meta (
      remote_jid, instance_name, assigned_agent_id, status, notes, tags,
      last_read_at, updated_at
    )
    select mappings.canonical_jid, meta.instance_name, meta.assigned_agent_id,
           meta.status, meta.notes, meta.tags, meta.last_read_at, meta.updated_at
    from conversation_meta meta
    join valid_mappings mappings
      on mappings.instance_name = meta.instance_name
     and mappings.alias_jid = meta.remote_jid
    on conflict (remote_jid, instance_name) do update set
      assigned_agent_id = coalesce(conversation_meta.assigned_agent_id, excluded.assigned_agent_id),
      notes = coalesce(nullif(conversation_meta.notes, ''), excluded.notes),
      tags = case when conversation_meta.tags = '[]'::jsonb then excluded.tags else conversation_meta.tags end,
      last_read_at = greatest(conversation_meta.last_read_at, excluded.last_read_at),
      updated_at = greatest(conversation_meta.updated_at, excluded.updated_at)
  `;
  await sql`
    with mappings as (
      select distinct instance_name, remote_jid as alias_jid,
        case
          when from_me then coalesce(
            nullif(raw #>> '{Info,RecipientAlt}', ''),
            nullif(raw #>> '{info,recipientAlt}', '')
          )
          else coalesce(
            nullif(raw #>> '{Info,SenderAlt}', ''),
            nullif(raw #>> '{info,senderAlt}', ''),
            nullif(raw #>> '{Info,Sender}', ''),
            nullif(raw #>> '{info,sender}', '')
          )
        end as canonical_jid
      from messages
      where remote_jid like '%@lid'
    )
    delete from conversation_meta meta using mappings
    where meta.instance_name = mappings.instance_name
      and meta.remote_jid = mappings.alias_jid
      and mappings.canonical_jid like '%@s.whatsapp.net'
      and mappings.canonical_jid <> mappings.alias_jid
  `;
  await sql`
    with mappings as (
      select message_id,
        case
          when from_me then coalesce(
            nullif(raw #>> '{Info,RecipientAlt}', ''),
            nullif(raw #>> '{info,recipientAlt}', '')
          )
          else coalesce(
            nullif(raw #>> '{Info,SenderAlt}', ''),
            nullif(raw #>> '{info,senderAlt}', ''),
            nullif(raw #>> '{Info,Sender}', ''),
            nullif(raw #>> '{info,sender}', '')
          )
        end as canonical_jid
      from messages
      where remote_jid like '%@lid'
    )
    update messages set remote_jid = mappings.canonical_jid
    from mappings
    where messages.message_id = mappings.message_id
      and mappings.canonical_jid like '%@s.whatsapp.net'
      and mappings.canonical_jid <> messages.remote_jid
  `;
  await sql`create index if not exists messages_chat_time_idx on messages(instance_name, remote_jid, message_timestamp)`;
  await sql`create index if not exists webhook_events_instance_created_idx on webhook_events(instance_name, created_at desc)`;
  await sql`create unique index if not exists agents_instance_name_idx on agents(instance_name) where instance_name is not null`;
  initialized = true;
}
