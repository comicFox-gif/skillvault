import { NextResponse } from "next/server";
import { exitTournament } from "@/lib/server/tournamentStore";
import { checkRateLimit } from "@/lib/server/rateLimit";

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
    const limit = checkRateLimit({
      request,
      key: `tournaments:${id}:exit`,
      max: 10,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many exit attempts. Retry in ${limit.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }
    const payload = (await request.json().catch(() => ({}))) as { wallet?: string };
    const item = await exitTournament(id, String(payload.wallet ?? ""));
    return NextResponse.json({ item }, { status: 200 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to exit tournament") }, { status: 400 });
  }
}
