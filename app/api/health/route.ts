import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "inovalot-panel",
    evolutionConfigured: Boolean(
      process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY,
    ),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    timestamp: new Date().toISOString(),
  });
}
