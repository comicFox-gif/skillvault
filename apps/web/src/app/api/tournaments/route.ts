import { NextResponse } from "next/server";
import { createTournament, listTournaments } from "@/lib/server/tournamentStore";

export const runtime = "nodejs";

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "30");
    const items = await listTournaments(limit);
    return NextResponse.json({ items });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load tournaments") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as {
      title?: string;
      game?: string;
      platform?: string;
      size?: number;
      timeframeMins?: number;
      format?: "bracket" | "league";
      pointsTarget?: number | null;
      stakeWei?: string;
      stakeChainId?: number;
      creatorStakeEscrowMatchId?: string;
      creatorWallet?: string;
      creatorUsername?: string;
    };

    const item = await createTournament({
      title: String(payload.title ?? ""),
      game: String(payload.game ?? ""),
      platform: String(payload.platform ?? ""),
      size: Number(payload.size ?? 0),
      timeframeMins: Number(payload.timeframeMins ?? 0),
      format: payload.format,
      pointsTarget: payload.pointsTarget ?? null,
      stakeWei: String(payload.stakeWei ?? ""),
      stakeChainId: Number(payload.stakeChainId ?? 0),
      creatorStakeEscrowMatchId: String(payload.creatorStakeEscrowMatchId ?? ""),
      creatorWallet: String(payload.creatorWallet ?? ""),
      creatorUsername: String(payload.creatorUsername ?? ""),
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to create tournament") }, { status: 400 });
  }
}
