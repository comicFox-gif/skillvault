"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog, isAddress, parseEther, type Address } from "viem";
import { encodeMatchCode } from "@/lib/matchCode";

const escrowAbi = [
  {
    type: "function",
    name: "createMatch",
    stateMutability: "payable",
    inputs: [
      { name: "opponent", type: "address" },
      { name: "stake", type: "uint256" },
      { name: "joinBySeconds", type: "uint64" },
      { name: "confirmBySeconds", type: "uint64" },
    ],
    outputs: [{ name: "matchId", type: "uint256" }],
  },
  {
    type: "event",
    name: "MatchCreated",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "opponent", type: "address", indexed: true },
      { name: "stake", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "nextMatchId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export default function CreateMatchPage() {
  const router = useRouter();
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  type BaseWriteConfig = Parameters<typeof writeContractAsync>[0];
  type WriteConfig = Omit<BaseWriteConfig, "value" | "nonce"> & {
    value?: bigint;
    nonce?: number;
  };

  const escrowAddress = process.env.NEXT_PUBLIC_MATCH_ESCROW_ADDRESS as
    | `0x${string}`
    | undefined;
  const nativeSymbol = process.env.NEXT_PUBLIC_NATIVE_SYMBOL || "DEV";

  const [stakeEth, setStakeEth] = useState("0.01");
  const [opponentAddress, setOpponentAddress] = useState<Address>(
    "0x0000000000000000000000000000000000000000",
  );
  const [joinMins, setJoinMins] = useState("30");
  const [confirmMins, setConfirmMins] = useState("60");
  const [game, setGame] = useState<"eFootball" | "FC26" | "FC25" | "Mortal Kombat">("eFootball");
  const [platform, setPlatform] = useState<"Console" | "PC" | "Mobile">("Console");
  const [timeframe, setTimeframe] = useState("10");
  const [prefillApplied, setPrefillApplied] = useState(false);

  const [txHash, setTxHash] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState<"idle" | "signing" | "pending">("idle");
  const [checkingReceipt, setCheckingReceipt] = useState(false);
  const [expectedMatchId, setExpectedMatchId] = useState<string | null>(null);

  async function writeWithNonce(config: WriteConfig) {
    if (!publicClient || !address) {
      return writeContractAsync(config as Parameters<typeof writeContractAsync>[0]);
    }
    const nonce = Number(await publicClient.getTransactionCount({ address, blockTag: "pending" }));
    return writeContractAsync({ ...config, nonce } as Parameters<typeof writeContractAsync>[0]);
  }

  const roomCode = useMemo(() => {
    if (!matchId) return null;
    return encodeMatchCode(matchId);
  }, [matchId]);

  useEffect(() => {
    if (!roomCode) return;
    const timeParam = encodeURIComponent(timeframe);
    const target = `/matches/${encodeURIComponent(roomCode)}?t=${timeParam}`;
    const timeoutId = window.setTimeout(() => {
      router.push(target);
    }, 450);
    return () => window.clearTimeout(timeoutId);
  }, [roomCode, timeframe, router]);

  useEffect(() => {
    if (prefillApplied) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const stakeParam = params.get("stake");
    const timeframeParam = params.get("timeframe");
    const opponentParam = params.get("opponent");

    if (stakeParam) setStakeEth(stakeParam);
    if (timeframeParam && /^\d+$/.test(timeframeParam)) setTimeframe(timeframeParam);
    if (opponentParam && isAddress(opponentParam)) setOpponentAddress(opponentParam);

    setPrefillApplied(true);
  }, [prefillApplied]);

  useEffect(() => {
    setConfirmMins(timeframe);
  }, [timeframe]);

  useEffect(() => {
    if (!matchId || typeof window === "undefined") return;
    const meta = {
      game,
      platform,
      timeframe: Number(timeframe),
      createdAt: Date.now(),
    };
    window.localStorage.setItem(`match-meta:${matchId}`, JSON.stringify(meta));
  }, [matchId, game, platform, timeframe]);

  async function onCreate() {
    if (creating) return;
    setError(null);
    setTxHash(null);
    setMatchId(null);
    setCreating(true);
    setCreateStatus("signing");

    if (!escrowAddress) {
      setError("Missing NEXT_PUBLIC_MATCH_ESCROW_ADDRESS in .env.local");
      return;
    }

    try {
      if (!publicClient) {
        throw new Error("Wallet client not ready. Please refresh and try again.");
      }
      const nextId = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "nextMatchId",
        args: [],
      });
      const expectedId = typeof nextId === "bigint" ? nextId.toString() : null;
      setExpectedMatchId(expectedId);
      const stakeWei = parseEther(stakeEth || "0");
      const joinBySeconds = BigInt(Math.max(1, Number(joinMins || "30"))) * 60n;
      const confirmBySeconds = BigInt(Math.max(1, Number(timeframe || "10"))) * 60n;
      const hash = await writeWithNonce({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "createMatch",
        args: [opponentAddress, stakeWei, joinBySeconds, confirmBySeconds] as const,
        value: stakeWei,
      });

      setTxHash(hash);
      setCreateStatus("pending");

      await resolveMatchId(hash, expectedId);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || String(e));
    } finally {
      setCreating(false);
      setCreateStatus("idle");
    }
  }

  async function resolveMatchId(hash: `0x${string}`, expectedId: string | null) {
    if (!publicClient) return;
    setCheckingReceipt(true);
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const escrowAddrLower = escrowAddress?.toLowerCase();
      if (!escrowAddrLower) return;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== escrowAddrLower) continue;
        try {
          const decoded = decodeEventLog({
            abi: escrowAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "MatchCreated") {
            const id = decoded.args.matchId;
            if (typeof id === "bigint") {
              setMatchId(id.toString());
              break;
            }
          }
        } catch {
          // ignore non-matching logs
        }
      }
      if (!matchId && expectedId) {
        await pollNextMatchId(expectedId);
      }
    } finally {
      setCheckingReceipt(false);
    }
  }

  async function pollNextMatchId(expectedId: string) {
    if (!publicClient || !escrowAddress) return;
    const expected = BigInt(expectedId);
    for (let i = 0; i < 8; i += 1) {
      const nextId = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "nextMatchId",
        args: [],
      });
      if (typeof nextId === "bigint" && nextId > expected) {
        setMatchId(expectedId);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return (
    <main
      className="relative min-h-screen w-full overflow-x-hidden bg-transparent text-white selection:bg-sky-500/30"
    >
      {/* Background FX */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] h-[600px] w-[600px] rounded-full bg-sky-900/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full bg-slate-700/20 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white sm:text-4xl">
            Create <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-sky-200">Match</span>
          </h1>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link
              className="group relative flex items-center justify-center overflow-hidden border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-white/10 sm:text-sm"
              href="/"
            >
              Back
            </Link>
            <Link
              className="group relative flex items-center justify-center overflow-hidden border border-sky-500/30 bg-sky-500/10 px-6 py-2 text-xs font-bold uppercase tracking-wider text-sky-400 transition-all hover:bg-sky-500/20 sm:text-sm"
              href="/matches"
            >
              Matches
            </Link>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(59,130,246,0.12),transparent_45%)]" />
          <div className="relative rounded-[22px] bg-slate-900/90 p-8 backdrop-blur-xl h-full">
            <div className="grid gap-6">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Stake ({nativeSymbol})</label>
                <input
                  className="w-full border border-white/10 bg-black/50 p-4 text-lg font-bold text-white placeholder-gray-700 outline-none focus:border-sky-500 transition-all"
                  value={stakeEth}
                  onChange={(e) => setStakeEth(e.target.value)}
                  placeholder="0.01"
                />
                <p className="mt-2 text-[10px] uppercase tracking-widest text-gray-600">
                  Creator stake is locked immediately on creation.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Game</label>
                <div className="grid grid-cols-2 gap-3">
                  {(["eFootball", "FC26", "FC25", "Mortal Kombat"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGame(g)}
                      className={`rounded-2xl border px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${
                        game === g
                          ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
                          : "border-white/10 bg-black/40 text-gray-400 hover:text-white"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Platform</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(["Console", "PC", "Mobile"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPlatform(p)}
                        className={`rounded-2xl border px-2 py-2 text-[10px] font-bold uppercase tracking-wider transition ${
                          platform === p
                            ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
                            : "border-white/10 bg-black/40 text-gray-400 hover:text-white"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Timeframe (mins)</label>
                  <select
                    className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                  >
                    {Array.from({ length: 15 }, (_, i) => String(i + 6)).map((m) => (
                      <option key={m} value={m}>
                        {m} minutes
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Join Deadline (Mins)</label>
                  <input
                    className="w-full border border-white/10 bg-black/50 p-4 text-white outline-none focus:border-sky-500"
                    value={joinMins}
                    onChange={(e) => setJoinMins(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">
                    Keeper Timeout (Mins)
                  </label>
                  <input
                    className="w-full border border-white/10 bg-black/50 p-4 text-white outline-none focus:border-sky-500"
                    value={confirmMins}
                    readOnly
                    disabled
                  />
                  <p className="mt-2 text-[10px] uppercase tracking-widest text-gray-600">
                    Auto-synced to match timeframe.
                  </p>
                </div>
              </div>

              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button
                    className="mt-4 w-full rounded-2xl border border-sky-500/40 bg-sky-500/20 p-4 text-xs font-bold uppercase tracking-wider text-sky-100 transition-all hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
                    onClick={() => {
                      if (!isConnected) {
                        const shouldConnect =
                          typeof window !== "undefined" &&
                          window.confirm("Connect wallet to create a match?");
                        if (!shouldConnect) return;
                        openConnectModal();
                        return;
                      }
                      onCreate();
                    }}
                    disabled={!escrowAddress || creating}
                  >
                    {creating ? "Creating Match..." : "Initialize Match"}
                  </button>
                )}
              </ConnectButton.Custom>
            </div>

            {createStatus !== "idle" && (
              <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3 text-xs text-sky-200">
                {createStatus === "signing"
                  ? "Waiting for wallet confirmation..."
                  : "Transaction sent, waiting for confirmation..."}
              </div>
            )}

            {!roomCode && txHash && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6">
                <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-sky-500/30 bg-slate-900/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-6">
                  <div className="mb-4 text-xs uppercase tracking-[0.35em] text-sky-400/80">Match Created</div>
                  <h3 className="text-2xl font-semibold text-white">Finalizing match...</h3>
                  <p className="mt-2 text-sm text-gray-400">
                    We sent the transaction. Waiting for confirmation to fetch your room code.
                  </p>

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    {txHash && (
                      <button
                        className="flex-1 rounded-2xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-200"
                        onClick={() => resolveMatchId(txHash as `0x${string}`, expectedMatchId)}
                        disabled={checkingReceipt}
                      >
                        {checkingReceipt ? "Checking..." : "Check Again"}
                      </button>
                    )}
                    <button
                      className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white"
                      onClick={() => {
                        setMatchId(null);
                        setTxHash(null);
                      }}
                    >
                      Close
                    </button>
                  </div>

                  {txHash && (
                    <div className="mt-4 text-[10px] uppercase tracking-[0.3em] text-gray-500">
                      Transaction submitted
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400 font-mono break-all">
                {error}
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-white/10 bg-black/50 p-4 text-xs text-gray-300">
              <div className="text-[10px] uppercase tracking-[0.35em] text-gray-500 mb-3">Match Rules & Safety</div>
              <div className="space-y-3">
                <div>
                  <div className="uppercase tracking-wider text-sky-400 text-[11px]">{game} rules</div>
                  {game === "Mortal Kombat" ? (
                    <ul className="mt-2 list-disc pl-4 space-y-1 text-gray-400">
                      <li>First to 3 wins (FT3), standard tournament settings.</li>
                      <li>No custom modifiers, no consumables, no pause abuse.</li>
                      <li>Disconnects before one round: replay; after a full round: opponent may claim win.</li>
                      <li>Record final screen for dispute evidence.</li>
                    </ul>
                  ) : (
                    <ul className="mt-2 list-disc pl-4 space-y-1 text-gray-400">
                      <li>Standard 1v1 match, default competitive settings.</li>
                      <li>No custom gameplay modifiers or assisted exploits.</li>
                      <li>Disconnect before halftime: replay; after halftime: opponent may claim win.</li>
                      <li>Record final score screen for disputes.</li>
                    </ul>
                  )}
                </div>
                <div>
                  <div className="uppercase tracking-wider text-sky-400 text-[11px]">Fair play</div>
                  <ul className="mt-2 list-disc pl-4 space-y-1 text-gray-400">
                    <li>Respectful conduct; no harassment or cheating tools.</li>
                    <li>Platform: {platform}. Timeframe: {timeframe} minutes.</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-[11px] text-red-300">
                  Gambling Warning: This is a skill-based competition platform. Do not wager more than you can afford to lose.
                  If you feel at risk of gambling addiction, please seek help in your region.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}





