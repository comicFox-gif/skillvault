import { NextResponse } from "next/server";
import { deleteTournament, getTournamentById } from "@/lib/server/tournamentStore";

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

export async function GET(_request: Request, context: ParamsContext) {
  try {
    const id = await getId(context);
    if (!id) return NextResponse.json({ error: "Invalid tournament id" }, { status: 400 });
    const item = await getTournamentById(id);
    if (!item) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load tournament") }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: ParamsContext) {
  try {
    const id = await getId(context);
    if (!id) return NextResponse.json({ error: "Invalid tournament id" }, { status: 400 });
    const payload = (await request.json().catch(() => ({}))) as { wallet?: string };
    const result = await deleteTournament(id, String(payload.wallet ?? ""));
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to delete tournament") }, { status: 400 });
  }
}
