import { NextResponse } from "next/server";
import { getReputationSnapshot, saveReputationSnapshot } from "@/lib/server/disputeStore";
import { checkRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

function normalizeWalletInput(value: string) {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const chainIdRaw = url.searchParams.get("chainId");
    const walletsRaw = url.searchParams.get("wallets");
    if (!chainIdRaw || !walletsRaw) {
      return NextResponse.json({ error: "chainId and wallets are required." }, { status: 400 });
    }

    const chainId = Number(chainIdRaw);
    if (!Number.isFinite(chainId) || chainId <= 0) {
      return NextResponse.json({ error: "Invalid chainId." }, { status: 400 });
    }

    const wallets = normalizeWalletInput(walletsRaw);
    if (wallets.length === 0) {
      return NextResponse.json({ items: {} });
    }

    const results = await Promise.all(
      wallets.map(async (wallet) => [wallet, await getReputationSnapshot(chainId, wallet)] as const),
    );
    const items: Record<string, unknown> = {};
    for (const [wallet, snapshot] of results) {
      if (snapshot) items[wallet] = snapshot;
    }
    return NextResponse.json({ items });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to fetch reputation." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const limit = checkRateLimit({
      request,
      key: "reputation:post",
      max: 60,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many reputation updates. Retry in ${limit.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }

    const payload = (await request.json()) as {
      chainId?: number;
      byWallet?: Record<
        string,
        {
          wins: number;
          losses: number;
          resolved: number;
          disputes: number;
          noResponseFlags: number;
          entries: Array<{ matchId: string; opponent: string; result: "Win" | "Loss" | "Pending" | "Disputed" }>;
        }
      >;
    };

    if (!payload || !payload.chainId || !payload.byWallet) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    await saveReputationSnapshot({
      chainId: Number(payload.chainId),
      byWallet: payload.byWallet,
    });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to save reputation." }, { status: 400 });
  }
}
