import { randomBytes } from "node:crypto";
import { db, ensureSchema } from "@/lib/db";
import { evolutionConfig } from "@/lib/evolution";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

export type AgentConnection = {
  agentId: string;
  agentName: string;
  instanceName: string;
  token: string;
};

export function instanceSlug(name: string, id: string) {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "agente";
  return `crm-${slug}-${id.slice(0, 8)}`;
}

export function newConnectionToken() {
  return randomBytes(32).toString("hex");
}

export async function agentConnection(agentId: string): Promise<AgentConnection> {
  await ensureSchema();
  const [agent] = await db()`
    select id, name, instance_name as "instanceName", connection_token as "connectionToken"
    from agents where id = ${agentId}
  `;
  if (!agent) throw new Error("Agente não encontrado.");

  const instanceName = String(agent.instanceName || "");
  if (!instanceName) throw new Error("Salve o agente antes de conectar o WhatsApp.");

  let token: string;
  if (agent.connectionToken) {
    token = decryptSecret(String(agent.connectionToken));
  } else if (instanceName === evolutionConfig().instance) {
    // Migration path for the connection that predates per-agent credentials.
    token = evolutionConfig().instanceToken;
    await db()`
      update agents set connection_token = ${encryptSecret(token)}, updated_at = now()
      where id = ${agentId} and connection_token is null
    `;
  } else {
    token = newConnectionToken();
    await db()`
      update agents set connection_token = ${encryptSecret(token)}, updated_at = now()
      where id = ${agentId} and connection_token is null
    `;
  }

  return {
    agentId: String(agent.id),
    agentName: String(agent.name),
    instanceName,
    token,
  };
}

export async function connectionByInstance(instanceName: string): Promise<AgentConnection | null> {
  await ensureSchema();
  const [agent] = await db()`select id from agents where instance_name = ${instanceName}`;
  return agent ? agentConnection(String(agent.id)) : null;
}
