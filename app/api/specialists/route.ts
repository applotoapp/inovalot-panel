import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, ensureSchema } from "@/lib/db";
import { specialistKeys } from "@/lib/specialist-seed";

export const dynamic = "force-dynamic";

const providerSchema = z.enum(["openai", "xai", "anthropic", "google", "openrouter"]);
const knowledgeArticleSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9-]+$/),
  category: z.string().trim().min(2).max(80),
  title: z.string().trim().min(3).max(180),
  content: z.string().trim().min(10).max(30_000),
  sourceUrl: z.union([z.string().trim().url(), z.literal("")]).default(""),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  verifiedAt: z.union([z.string().datetime(), z.null()]).optional(),
});
const specialistSchema = z.object({
  id: z.string().uuid(),
  key: z.enum(specialistKeys),
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().max(300).default(""),
  provider: providerSchema,
  model: z.string().trim().min(2).max(120),
  systemPrompt: z.string().trim().min(20).max(40_000),
  temperature: z.number().min(0).max(2).default(0.25),
  enabled: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  knowledgeArticles: z.array(knowledgeArticleSchema).max(100).default([]),
});

type SpecialistListItem = Record<string, unknown> & {
  id: string;
  knowledgeArticles: Record<string, unknown>[];
  tools: Record<string, unknown>[];
};

async function listSpecialists(): Promise<SpecialistListItem[]> {
  const specialists = await db()`
    select id, key, name, description, provider, model,
           system_prompt as "systemPrompt", temperature, enabled,
           is_default as "isDefault", sort_order as "sortOrder", version,
           created_at as "createdAt", updated_at as "updatedAt"
    from specialists
    order by sort_order, name
  ` as unknown as Array<Record<string, unknown> & { id: string }>;
  return Promise.all(specialists.map(async (specialist) => {
    const knowledgeArticles = await db()`
      select id, slug, category, title, content, source_url as "sourceUrl",
             enabled, sort_order as "sortOrder", verified_at as "verifiedAt",
             updated_at as "updatedAt"
      from knowledge_articles
      where specialist_id = ${specialist.id}
      order by sort_order, title
    `;
    const tools = await db()`
      select tool_key as "toolKey", enabled, config, updated_at as "updatedAt"
      from specialist_tools
      where specialist_id = ${specialist.id}
      order by tool_key
    `;
    return {
      ...specialist,
      knowledgeArticles: [...knowledgeArticles],
      tools: [...tools],
    } as SpecialistListItem;
  }));
}

export async function GET() {
  try {
    await ensureSchema();
    return NextResponse.json({ data: await listSpecialists() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar especialistas." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = specialistSchema.parse(await request.json());
    await ensureSchema();
    await db().begin(async (sql) => {
      const [existing] = await sql`
        select key from specialists where id = ${input.id} limit 1
      `;
      if (!existing || existing.key !== input.key) {
        throw new Error("Especialista não encontrado ou identificador inválido.");
      }
      if (input.isDefault) {
        await sql`update specialists set is_default = false where id <> ${input.id} and is_default = true`;
      }
      await sql`
        update specialists set
          name = ${input.name},
          description = ${input.description},
          provider = ${input.provider},
          model = ${input.model},
          system_prompt = ${input.systemPrompt},
          temperature = ${input.temperature},
          enabled = ${input.enabled},
          is_default = ${input.isDefault},
          sort_order = ${input.sortOrder},
          version = version + 1,
          updated_at = now()
        where id = ${input.id}
      `;
      for (const article of input.knowledgeArticles) {
        await sql`
          insert into knowledge_articles (
            id, specialist_id, slug, category, title, content, source_url,
            enabled, sort_order, verified_at
          ) values (
            ${article.id || crypto.randomUUID()}, ${input.id}, ${article.slug},
            ${article.category}, ${article.title}, ${article.content}, ${article.sourceUrl},
            ${article.enabled}, ${article.sortOrder}, ${article.verifiedAt || null}
          )
          on conflict (specialist_id, slug) do update set
            category = excluded.category,
            title = excluded.title,
            content = excluded.content,
            source_url = excluded.source_url,
            enabled = excluded.enabled,
            sort_order = excluded.sort_order,
            verified_at = excluded.verified_at,
            updated_at = now()
        `;
      }
    });
    const specialists = await listSpecialists();
    return NextResponse.json({ data: specialists.find((specialist) => specialist.id === input.id) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Revise os campos do especialista.", issues: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar especialista." },
      { status: 500 },
    );
  }
}
