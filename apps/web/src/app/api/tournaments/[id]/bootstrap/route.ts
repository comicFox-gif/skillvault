import { NextResponse } from "next/server";
import { bootstrapTournamentIfReady } from "@/lib/server/tournamentStore";

export const runtime = "nodejs";

type ParamsContext = {
  params: Promise<{ id: string }> | { id: string };
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function getId(context: ParamsContext) {
  const params = await Promise.resolve(context.params);
  return String(params.id ?? "").trim();
}

export async function POST(_request: Request, context: ParamsContext) {
  try {
    const id = await getId(context);
    if (!id) return NextResponse.json({ error: "Invalid tournament id" }, { status: 400 });
    const item = await bootstrapTournamentIfReady(id);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to bootstrap tournament") },
      { status: 400 },
    );
  }
}
