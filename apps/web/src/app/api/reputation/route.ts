import { NextResponse } from "next/server";
import { createPublicClient, http, zeroAddress, type Address } from "viem";
import { getReputationSnapshot, saveReputationSnapshot } from "@/lib/server/disputeStore";
import { checkRateLimit } from "@/lib/server/rateLimit";
import { getEscrowAddressForChain, getRpcUrlsForChain } from "@/lib/chains";

export const runtime = "nodejs";

const escrowAbi = [
  {
    type: "function",
    name: "getMatch",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "opponent", type: "address" },
      { name: "stake", type: "uint256" },
      { name: "joinedAt", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "creatorPaid", type: "bool" },
      { name: "opponentPaid", type: "bool" },
      { name: "proposedWinner", type: "address" },
    ],
  },
  {
    type: "function",
    name: "nextMatchId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "creatorReportedWinner",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "opponentReportedWinner",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "resolvedWinner",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

type HistoryResult = "Win" | "Loss" | "Disputed";
type HistoryEntry = { matchId: string; opponent: string; result: HistoryResult };
type WalletStats = {
  wins: number;
  losses: number;
  disputes: number;
  entries: HistoryEntry[];
};

function normalizeWalletInput(value: string) {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function rebuildOnChain(
  chainId: number,
  wallets: string[],
): Promise<Record<string, WalletStats> | null> {
  const escrowAddress = getEscrowAddressForChain(chainId);
  const rpcUrls = getRpcUrlsForChain(chainId);
  if (!escrowAddress || rpcUrls.length === 0) return null;

  const client = createPublicClient({
    transport: http(rpcUrls[0], { timeout: 10_000 }),
  });

  let nextMatchId: bigint;
  try {
    nextMatchId = (await client.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "nextMatchId",
      args: [],
    })) as bigint;
  } catch {
    return null;
  }

  const count = Number(nextMatchId);
  if (count === 0) return null;

  const tracked = new Set(wallets.map((w) => w.toLowerCase()));
  const built: Record<string, WalletStats> = {};
  for (const w of tracked) {
    built[w] = { wins: 0, losses: 0, disputes: 0, entries: [] };
  }

  const chunkSize = 25;
  for (let start = 0; start < count; start += chunkSize) {
    const ids = Array.from(
      { length: Math.min(chunkSize, count - start) },
      (_, i) => BigInt(start + i),
    );
    const reads = await Promise.all(
      ids.map(async (matchId) => {
        try {
          const row = await client.readContract({
            address: escrowAddress,
            abi: escrowAbi,
            functionName: "getMatch",
            args: [matchId],
          });
          return { id: matchId, data: row };
        } catch {
          return null;
        }
      }),
    );
    for (const item of reads) {
      if (!item) continue;
      const [rowCreator, rowOpponent, , , rowStatus, , , rowWinner] = item.data as readonly [
        Address, Address, bigint, bigint, bigint | number, boolean, boolean, Address,
      ];
      const creatorLower = rowCreator.toLowerCase();
      const opponentLower = rowOpponent.toLowerCase();
      if (opponentLower === zeroAddress) continue;

      const statusVal = Number(rowStatus);
      if (statusVal !== 4 && statusVal !== 5) continue;

      for (const wallet of tracked) {
        const isCreatorWallet = wallet === creatorLower;
        const isOpponentWallet = wallet === opponentLower;
        if (!isCreatorWallet && !isOpponentWallet) continue;

        const walletHistory = built[wallet];
        const rival = isCreatorWallet ? opponentLower : creatorLower;
        let result: HistoryResult;
        if (statusVal === 5) {
          if (rowWinner.toLowerCase() === wallet) {
            walletHistory.wins += 1;
            result = "Win";
          } else {
            walletHistory.losses += 1;
            result = "Loss";
          }
        } else {
          walletHistory.disputes += 1;
          result = "Disputed";
        }
        walletHistory.entries.push({
          matchId: item.id.toString(),
          opponent: rival,
          result,
        });
      }
    }
  }

  for (const wallet of Object.keys(built)) {
    built[wallet].entries.sort((a, b) => Number(b.matchId) - Number(a.matchId));
    built[wallet].entries = built[wallet].entries.slice(0, 6);
  }

  // Cache the rebuilt data
  void saveReputationSnapshot({ chainId, byWallet: built }).catch(() => {});

  return built;
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

    // Try cache first
    const results = await Promise.all(
      wallets.map(async (wallet) => [wallet, await getReputationSnapshot(chainId, wallet)] as const),
    );
    const items: Record<string, unknown> = {};
    const missingWallets: string[] = [];
    for (const [wallet, snapshot] of results) {
      if (snapshot) {
        items[wallet] = snapshot;
      } else {
        missingWallets.push(wallet);
      }
    }

    // If any wallets missing from cache, rebuild from on-chain
    if (missingWallets.length > 0) {
      const rebuilt = await rebuildOnChain(chainId, missingWallets);
      if (rebuilt) {
        for (const wallet of missingWallets) {
          if (rebuilt[wallet]) {
            items[wallet] = rebuilt[wallet];
          }
        }
      }
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
          resolved?: number;
          disputes: number;
          noResponseFlags?: number;
          entries: Array<{ matchId: string; opponent: string; result: "Win" | "Loss" | "Disputed" }>;
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
