import { db } from "@/lib/db";
import { classifySpecialist } from "@/lib/specialist-routing";
import type { SpecialistKey } from "@/lib/specialist-seed";

const MAX_KNOWLEDGE_CONTEXT_CHARS = 36_000;

export type ActiveSpecialist = {
  id: string;
  key: SpecialistKey;
  name: string;
  description: string;
  provider: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  isDefault: boolean;
  knowledgeContext: string;
};

type SpecialistRow = Omit<ActiveSpecialist, "knowledgeContext">;

function buildKnowledgeContext(rows: Record<string, unknown>[]) {
  const articles = rows.map((article) => {
    const source = String(article.sourceUrl || "").trim();
    const verifiedAt = article.verifiedAt
      ? new Date(String(article.verifiedAt)).toLocaleDateString("pt-BR")
      : "data não informada";
    return [
      `## ${String(article.title)}`,
      `Categoria: ${String(article.category)} · Verificado em: ${verifiedAt}`,
      source ? `Fonte oficial: ${source}` : "",
      String(article.content),
    ].filter(Boolean).join("\n");
  });
  return articles.join("\n\n").slice(0, MAX_KNOWLEDGE_CONTEXT_CHARS);
}

async function loadKnowledge(specialistId: string) {
  const rows = await db()`
    select title, category, content, source_url as "sourceUrl", verified_at as "verifiedAt"
    from knowledge_articles
    where specialist_id = ${specialistId} and enabled = true
    order by sort_order, title
  `;
  return buildKnowledgeContext(rows);
}

export async function resolveConversationSpecialist(input: {
  instanceName: string;
  remoteJid: string;
  messageText: string;
}): Promise<ActiveSpecialist | null> {
  const specialists = await db()`
    select id, key, name, description, provider, model,
           system_prompt as "systemPrompt", temperature, is_default as "isDefault"
    from specialists
    where enabled = true
    order by is_default desc, sort_order, name
  ` as SpecialistRow[];
  if (!specialists.length) return null;

  const [metadata] = await db()`
    select active_specialist_id as "activeSpecialistId"
    from conversation_meta
    where instance_name = ${input.instanceName} and remote_jid = ${input.remoteJid}
    limit 1
  `;
  const active = specialists.find((specialist) => specialist.id === metadata?.activeSpecialistId);
  const classifiedKey = classifySpecialist(input.messageText);
  const classified = classifiedKey
    ? specialists.find((specialist) => specialist.key === classifiedKey)
    : undefined;
  const fallback = specialists.find((specialist) => specialist.isDefault)
    || specialists.find((specialist) => specialist.key === "geral")
    || specialists[0];
  const selected = classified || active || fallback;
  const routingReason = classified
    ? `classificação:${classified.key}`
    : active
      ? "continuidade"
      : `padrão:${selected.key}`;

  if (!active || active.id !== selected.id) {
    await db()`
      insert into conversation_meta (
        remote_jid, instance_name, active_specialist_id, routing_reason, specialist_routed_at
      ) values (
        ${input.remoteJid}, ${input.instanceName}, ${selected.id}, ${routingReason}, now()
      )
      on conflict (remote_jid, instance_name) do update set
        active_specialist_id = excluded.active_specialist_id,
        routing_reason = excluded.routing_reason,
        specialist_routed_at = excluded.specialist_routed_at,
        updated_at = now()
    `;
  }

  return {
    ...selected,
    knowledgeContext: await loadKnowledge(selected.id),
  };
}

export function specialistRuntimeAgent(
  agent: Record<string, unknown>,
  specialist: ActiveSpecialist | null,
) {
  if (!specialist) return agent;
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  const knowledge = specialist.knowledgeContext
    ? `\n\n# Base de conhecimento autorizada\n\n${specialist.knowledgeContext}`
    : "\n\nA base deste especialista ainda não possui artigos publicados.";

  return {
    ...agent,
    provider: specialist.provider || agent.provider,
    model: specialist.model || agent.model,
    temperature: specialist.temperature,
    specialistId: specialist.id,
    specialistKey: specialist.key,
    systemPrompt: `${String(agent.systemPrompt)}

---

# Especialista interno ativo: ${specialist.name}

Data atual do atendimento: ${date}.

${specialist.systemPrompt}

Responda à solicitação dentro deste setor sem perguntar novamente qual setor o cliente deseja, salvo se a mensagem realmente pertencer a outro assunto.${knowledge}`,
  };
}
