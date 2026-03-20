import { NextResponse } from "next/server";
import { linkTournamentMatchEscrow } from "@/lib/server/tournamentStore";

export const runtime = "nodejs";

type ParamsContext = {
  params:
    | Promise<{ id: string; matchId: string }>
    | { id: string; matchId: string };
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function getParams(context: ParamsContext) {
  const params = await Promise.resolve(context.params);
  return {
    id: String(params.id ?? "").trim(),
    matchId: String(params.matchId ?? "").trim(),
  };
}

export async function POST(request: Request, context: ParamsContext) {
  try {
    const { id, matchId } = await getParams(context);
    if (!id || !matchId) {
      return NextResponse.json({ error: "Invalid tournament or match id" }, { status: 400 });
    }
    const payload = (await request.json().catch(() => ({}))) as {
      linkerWallet?: string;
      chainId?: number;
      roomCode?: string;
    };
    const item = await linkTournamentMatchEscrow(id, matchId, {
      linkerWallet: String(payload.linkerWallet ?? ""),
      chainId: Number(payload.chainId ?? 0),
      roomCode: String(payload.roomCode ?? ""),
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to link on-chain match") },
      { status: 400 },
    );
  }
}
