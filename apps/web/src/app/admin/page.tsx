"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { formatEther, type Address } from "viem";

const escrowAbi = [
  {
    type: "event",
    name: "Disputed",
    inputs: [{ name: "matchId", type: "uint256", indexed: true }],
  },
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
    name: "adminResolve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "winner", type: "address" },
      { name: "refundBoth", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const STATUS: Record<number, string> = {
  0: "Created",
  1: "Joined",
  2: "Funded",
  3: "ResultProposed",
  4: "Disputed",
  5: "Resolved",
  6: "Cancelled",
};

type MatchData = readonly [Address, Address, bigint, bigint, bigint | number, boolean, boolean, Address];

export default function AdminDisputesPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  type BaseWriteConfig = Parameters<typeof writeContractAsync>[0];
  type WriteConfig = Omit<BaseWriteConfig, "value" | "nonce"> & {
    value?: bigint;
    nonce?: number;
  };
  const escrowAddress = process.env.NEXT_PUBLIC_MATCH_ESCROW_ADDRESS as `0x${string}` | undefined;
  const nativeSymbol = process.env.NEXT_PUBLIC_NATIVE_SYMBOL || "DEV";
  const adminPassword = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "2162";

  const [matchIdInput, setMatchIdInput] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adminPassInput, setAdminPassInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const [disputedIds, setDisputedIds] = useState<string[]>([]);
  const [isLoadingDisputes, setIsLoadingDisputes] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);

  const matchId = useMemo(() => {
    const n = Number(matchIdInput);
    return Number.isFinite(n) && n >= 0 ? BigInt(n) : 0n;
  }, [matchIdInput]);

  const matchQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getMatch",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress) && matchIdInput.length > 0 },
  });

  const data = matchQuery.data as MatchData | undefined;
  const creator = data?.[0];
  const opponent = data?.[1];
  const stake = data?.[2];
  const joinedAt = data?.[3];
  const status = data?.[4];
  const proposedWinner = data?.[7];

  const statusNum = typeof status === "bigint" ? Number(status) : undefined;
  const statusText = typeof statusNum === "number" ? (STATUS[statusNum] ?? `Unknown(${statusNum})`) : "-";
  const stakeEth = typeof stake === "bigint" ? formatEther(stake) : "-";
  const isDisputed = statusNum === 4;

  useEffect(() => {
    const cached = typeof window !== "undefined" ? window.localStorage.getItem("admin_disputes_cache") : null;
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as string[];
        setDisputedIds(parsed);
      } catch {
        // ignore cache errors
      }
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    if (!publicClient || !escrowAddress) return;

    loadDisputes();
    const intervalId = window.setInterval(() => {
      loadDisputes();
    }, 20000);
    return () => window.clearInterval(intervalId);
  }, [authed, publicClient, escrowAddress]);

  async function writeWithNonce(config: WriteConfig) {
    if (!publicClient || !address) {
      return writeContractAsync(config as Parameters<typeof writeContractAsync>[0]);
    }
    const nonce = Number(await publicClient.getTransactionCount({ address, blockTag: "latest" }));
    return writeContractAsync({ ...config, nonce } as Parameters<typeof writeContractAsync>[0]);
  }

  async function resolveMatch(winner: Address, refundBoth: boolean) {
    if (!escrowAddress) return;
    setErr(null);
    setTxHash(null);
    try {
      const hash = await writeWithNonce({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "adminResolve",
        args: [matchId, winner, refundBoth] as const,
      });
      setTxHash(hash);
      setTimeout(() => matchQuery.refetch(), 600);
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
    }
  }

  async function loadDisputes() {
    if (!publicClient || !escrowAddress) return;
    if (isLoadingDisputes) return;
    setIsLoadingDisputes(true);
    setDisputeError(null);
    try {
      const nextMatchId = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "nextMatchId",
        args: [],
      });

      const count = Number(nextMatchId);
      const ids = Array.from({ length: count }, (_, i) => BigInt(i));
      const disputed: string[] = [];
      const chunkSize = 25;

      for (let start = 0; start < ids.length; start += chunkSize) {
        const chunk = ids.slice(start, start + chunkSize);
        const rows = await Promise.all(
          chunk.map(async (matchId) => {
            try {
              const row = await publicClient.readContract({
                address: escrowAddress,
                abi: escrowAbi,
                functionName: "getMatch",
                args: [matchId],
              });
              return { id: matchId, row: row as MatchData };
            } catch {
              return null;
            }
          }),
        );

        for (const item of rows) {
          if (!item) continue;
          const status = Number(item.row[4]);
          if (status === 4) {
            disputed.push(item.id.toString());
          }
        }
      }

      disputed.sort((a, b) => Number(a) - Number(b));

      const uniqueIds = Array.from(new Set(disputed));
      setDisputedIds(uniqueIds);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("admin_disputes_cache", JSON.stringify(uniqueIds));
      }
    } catch (e: any) {
      setDisputeError(e?.message || String(e));
    } finally {
      setIsLoadingDisputes(false);
    }
  }

  return (
    <main
      className="relative min-h-screen w-full overflow-x-hidden bg-transparent text-white selection:bg-sky-500/30"
    >
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] h-[600px] w-[600px] rounded-full bg-sky-900/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full bg-slate-700/20 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-black uppercase tracking-tight sm:text-3xl">
            Admin <span className="text-sky-400">Disputes</span>
          </h1>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link className="border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider sm:text-sm" href="/">
              Back
            </Link>
            <Link className="border border-sky-500/30 bg-sky-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-sky-300 sm:text-sm" href="/matches">
              Matches
            </Link>
          </div>
        </div>

        {!authed ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 backdrop-blur-xl">
            <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Admin Password</label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="password"
                value={adminPassInput}
                onChange={(e) => setAdminPassInput(e.target.value)}
                className="flex-1 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
                placeholder="Enter password"
              />
              <button
                className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-300"
                onClick={() => {
                  if (adminPassInput === adminPassword) {
                    setAuthed(true);
                    setPassError(null);
                  } else {
                    setPassError("Incorrect password.");
                  }
                }}
              >
                Unlock
              </button>
            </div>
            {passError && <div className="mt-3 text-xs text-red-400">{passError}</div>}
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 backdrop-blur-xl">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Disputed Matches</div>
                <div className="mt-1 text-[11px] text-gray-500">Auto-sync is on (refresh every 20s).</div>
              </div>
              <button
                className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-300"
                onClick={loadDisputes}
                disabled={isLoadingDisputes}
              >
                {isLoadingDisputes ? "Scanning..." : "Refresh Now"}
              </button>
            </div>

            {disputeError && <div className="mb-4 text-xs text-red-400 break-all">{disputeError}</div>}

            {disputedIds.length > 0 ? (
              <div className="mb-6 flex flex-wrap gap-2">
                {disputedIds.map((id) => (
                  <button
                    key={id}
                    className="rounded-2xl border border-white/10 bg-black/40 px-3 py-1 text-xs text-gray-300 hover:border-sky-500/40 hover:text-sky-300"
                    onClick={() => {
                      setMatchIdInput(id);
                      setTimeout(() => matchQuery.refetch(), 0);
                    }}
                  >
                    #{id}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mb-6 rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-gray-400">
                No disputed matches found yet.
              </div>
            )}

          <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Match ID</label>
          <div className="flex gap-3">
            <input
              value={matchIdInput}
              onChange={(e) => setMatchIdInput(e.target.value)}
              className="flex-1 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
              placeholder="Enter match id"
            />
            <button
              className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-300"
              onClick={() => matchQuery.refetch()}
              disabled={!matchIdInput}
            >
              Load
            </button>
          </div>

          {data && (
            <div className="mt-6 space-y-3 text-sm">
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-gray-500">Status</span>
                <span className="text-sky-400">{statusText}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-gray-500">Stake</span>
                <span>{stakeEth} {nativeSymbol}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-gray-500">Creator</span>
                <span className="break-all text-sky-400">{creator ?? "-"}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-gray-500">Opponent</span>
                <span className="break-all text-sky-400">{opponent ?? "-"}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-gray-500">Proposed Winner</span>
                <span className="break-all">{proposedWinner ?? "-"}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-gray-500">Joined At</span>
                <span>
                  {typeof joinedAt === "bigint" && joinedAt > 0n
                    ? new Date(Number(joinedAt) * 1000).toLocaleTimeString()
                    : "-"}
                </span>
              </div>
            </div>
          )}

          {data && !isDisputed && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-gray-400">
              Only disputed matches can be resolved here.
            </div>
          )}

          {data && isDisputed && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <button
                className="rounded-2xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-200"
                disabled={!isConnected || !creator}
                onClick={() => creator && resolveMatch(creator, false)}
              >
                Winner: Creator
              </button>
              <button
                className="rounded-2xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-200"
                disabled={!isConnected || !opponent}
                onClick={() => opponent && resolveMatch(opponent, false)}
              >
                Winner: Opponent
              </button>
              <button
                className="rounded-2xl border border-red-500/30 bg-slate-700/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-red-300"
                disabled={!isConnected}
                onClick={() => resolveMatch("0x0000000000000000000000000000000000000000", true)}
              >
                Refund Both
              </button>
            </div>
          )}

          {txHash && (
            <div className="mt-4 text-xs text-sky-400 break-all">Tx: {txHash}</div>
          )}
          {err && (
            <div className="mt-2 text-xs text-red-400 break-all">{err}</div>
          )}
          </div>
        )}
      </div>
    </main>
  );
}





