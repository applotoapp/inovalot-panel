import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuthorized } from "@/lib/admin-auth";
import { ensureSchema } from "@/lib/db";
import {
  deleteProviderApiKey,
  providerCredentialStatuses,
  providerDefinitions,
  saveProviderApiKey,
} from "@/lib/provider-credentials";

export const dynamic = "force-dynamic";

const providerIds = providerDefinitions.map((provider) => provider.id) as [
  (typeof providerDefinitions)[number]["id"],
  ...(typeof providerDefinitions)[number]["id"][],
];
const providerSchema = z.enum(providerIds);

function unauthorized() {
  return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
}

export async function GET(request: NextRequest) {
  if (!adminAuthorized(request)) return unauthorized();
  try {
    await ensureSchema();
    return NextResponse.json({ data: await providerCredentialStatuses() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar provedores." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!adminAuthorized(request)) return unauthorized();
  try {
    const body = z.object({
      provider: providerSchema,
      apiKey: z.string().trim().min(8).max(1000),
    }).parse(await request.json());
    await ensureSchema();
    await saveProviderApiKey(body.provider, body.apiKey);
    return NextResponse.json({ data: await providerCredentialStatuses() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Informe uma chave de API válida." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar a chave." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!adminAuthorized(request)) return unauthorized();
  try {
    const provider = providerSchema.parse(request.nextUrl.searchParams.get("provider"));
    await ensureSchema();
    await deleteProviderApiKey(provider);
    return NextResponse.json({ data: await providerCredentialStatuses() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao remover a chave." },
      { status: 400 },
    );
  }
}
