import { NextResponse } from "next/server";
import { exitTournament } from "@/lib/server/tournamentStore";

export const runtime = "nodejs";

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

type ParamsContext = {
  params: Promise<{ id: string }> | { id: string };
};

async function getId(context: ParamsContext) {
  const params = await Promise.resolve(context.params);
  return String(params.id ?? "").trim();
}

export async function POST(request: Request, context: ParamsContext) {
  try {
    const id = await getId(context);
    if (!id) return NextResponse.json({ error: "Invalid tournament id" }, { status: 400 });
    const payload = (await request.json().catch(() => ({}))) as { wallet?: string };
    const item = await exitTournament(id, String(payload.wallet ?? ""));
    return NextResponse.json({ item }, { status: 200 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to exit tournament") }, { status: 400 });
  }
}

