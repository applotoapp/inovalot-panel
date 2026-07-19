import { db } from "@/lib/db";
import { normalizeResponseDelaySeconds } from "@/lib/agent-runtime-config";

export type AgentReplyWindow = {
  instanceName: string;
  remoteJid: string;
  messageId: string;
  generation: number;
  dueAt: number;
};

function sleep(milliseconds: number) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function scheduleAgentReplyWindow(input: {
  instanceName: string;
  remoteJid: string;
  messageId: string;
  messageCreatedAt: Date;
  responseDelaySeconds: unknown;
}): Promise<AgentReplyWindow | null> {
  const delaySeconds = normalizeResponseDelaySeconds(input.responseDelaySeconds);
  const [row] = await db()`
    insert into agent_reply_windows (
      instance_name, remote_jid, latest_message_id, message_created_at,
      generation, response_due_at, updated_at
    )
    values (
      ${input.instanceName}, ${input.remoteJid}, ${input.messageId}, ${input.messageCreatedAt},
      1, now() + (${delaySeconds} * interval '1 second'), now()
    )
    on conflict (instance_name, remote_jid) do update set
      latest_message_id = excluded.latest_message_id,
      message_created_at = excluded.message_created_at,
      generation = agent_reply_windows.generation + 1,
      response_due_at = excluded.response_due_at,
      claimed_generation = null,
      claimed_at = null,
      updated_at = now()
    where excluded.message_created_at >= agent_reply_windows.message_created_at
    returning generation, response_due_at as "responseDueAt"
  `;
  if (!row) return null;

  return {
    instanceName: input.instanceName,
    remoteJid: input.remoteJid,
    messageId: input.messageId,
    generation: Number(row.generation),
    dueAt: new Date(row.responseDueAt).getTime(),
  };
}

export async function waitAndClaimAgentReplyWindow(window: AgentReplyWindow) {
  await sleep(Math.max(0, window.dueAt - Date.now()) + 25);
  const claimed = await db()`
    update agent_reply_windows
    set claimed_generation = generation, claimed_at = now(), updated_at = now()
    where instance_name = ${window.instanceName}
      and remote_jid = ${window.remoteJid}
      and latest_message_id = ${window.messageId}
      and generation = ${window.generation}
      and claimed_generation is null
      and response_due_at <= now()
    returning generation
  `;
  return claimed.length > 0;
}

export async function agentReplyWindowIsCurrent(window: AgentReplyWindow) {
  const rows = await db()`
    select 1
    from agent_reply_windows
    where instance_name = ${window.instanceName}
      and remote_jid = ${window.remoteJid}
      and latest_message_id = ${window.messageId}
      and generation = ${window.generation}
      and claimed_generation = ${window.generation}
    limit 1
  `;
  return rows.length > 0;
}

export async function finishAgentReplyWindow(window: AgentReplyWindow) {
  await db()`
    delete from agent_reply_windows
    where instance_name = ${window.instanceName}
      and remote_jid = ${window.remoteJid}
      and generation = ${window.generation}
  `;
}
