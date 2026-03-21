import { NextResponse } from "next/server";
import { joinTournament } from "@/lib/server/tournamentStore";
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
      key: `tournaments:${id}:join`,
      max: 10,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many join attempts. Retry in ${limit.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }
    const payload = (await request.json().catch(() => ({}))) as {
      wallet?: string;
      username?: string;
      stakeEscrowMatchId?: string;
      stakeChainId?: number;
    };
    const item = await joinTournament(
      id,
      String(payload.wallet ?? ""),
      String(payload.username ?? ""),
      String(payload.stakeEscrowMatchId ?? ""),
      Number(payload.stakeChainId ?? 0),
    );
    return NextResponse.json({ item }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to join tournament") }, { status: 400 });
  }
}
