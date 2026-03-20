"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog, parseEther, zeroAddress, type Address } from "viem";
import { createTournamentRequest, type TournamentFormat } from "@/lib/tournaments";
import {
  getEscrowAddressForChain,
  getNativeSymbolForChain,
  getSupportedChainNames,
  isSupportedChainId,
} from "@/lib/chains";
import { loadWalletProfile } from "@/lib/profile";
import { showBrowserNotification } from "@/lib/notifications";

const games = ["eFootball", "FC26", "FC25", "Mortal Kombat"] as const;
const platforms = ["Console", "PC", "Mobile"] as const;

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
    type: "function",
    name: "nextMatchId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
] as const;

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export default function CreateTournamentPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const escrowAddress = getEscrowAddressForChain(chainId);
  const nativeSymbol = getNativeSymbolForChain(chainId);
  const [title, setTitle] = useState("Neon Clash");
  const [game, setGame] = useState<(typeof games)[number]>("eFootball");
  const [platform, setPlatform] = useState<(typeof platforms)[number]>("Console");
  const [size, setSize] = useState("8");
  const [timeframe, setTimeframe] = useState("10");
  const [stakeAmount, setStakeAmount] = useState("0.02");
  const [format, setFormat] = useState<TournamentFormat>("bracket");
  const [pointsTarget, setPointsTarget] = useState("30");
  const [submitting, setSubmitting] = useState(false);
  const [lockState, setLockState] = useState<"idle" | "signing" | "pending">("idle");
  const [error, setError] = useState("");

  const payout = useMemo(() => {
    return [70, 20, 10];
  }, []);

  function extractMatchIdFromReceipt(receipt: any) {
    if (!escrowAddress) return null;
    const escrowLower = escrowAddress.toLowerCase();
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== escrowLower) continue;
      try {
        const decoded = decodeEventLog({
          abi: escrowAbi,
          data: log.data as `0x${string}`,
          topics: log.topics as any,
        });
        if (decoded.eventName === "MatchCreated") {
          const id = decoded.args.matchId;
          if (typeof id === "bigint") return id.toString();
        }
      } catch {
        // ignore unrelated logs
      }
    }
    return null;
  }

  async function handleCreate() {
    try {
      if (!isConnected || !address) {
        setError("Connect wallet before creating a tournament.");
        return;
      }
      if (!isSupportedChainId(chainId)) {
        setError(`Unsupported network. Switch to: ${getSupportedChainNames()}.`);
        return;
      }
      if (!escrowAddress) {
        setError("Escrow address is missing for this chain.");
        return;
      }
      if (!publicClient) {
        setError("Wallet client not ready. Reconnect and try again.");
        return;
      }
      setSubmitting(true);
      setLockState("signing");
      setError("");

      const profile = await loadWalletProfile(address);
      if (!profile?.username) {
        setError("Set your username in Profile before creating a tournament.");
        return;
      }

      const stakeWei = parseEther(stakeAmount || "0");
      if (stakeWei <= 0n) {
        setError("Stake must be greater than zero.");
        return;
      }

      const expected = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "nextMatchId",
        args: [],
      });
      const expectedMatchId = typeof expected === "bigint" ? expected.toString() : null;

      const txHash = await writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "createMatch",
        args: [
          zeroAddress,
          stakeWei,
          7n * 24n * 60n * 60n, // long join window so player can cancel before tournament start
          BigInt(Math.max(1, Number(timeframe || "10"))) * 60n,
        ],
        value: stakeWei,
      });
      setLockState("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error("Stake lock transaction reverted.");
      }

      const creatorStakeEscrowMatchId = extractMatchIdFromReceipt(receipt as any) ?? expectedMatchId;
      if (!creatorStakeEscrowMatchId) {
        throw new Error("Could not resolve stake lock ID from transaction.");
      }

      const created = await createTournamentRequest({
        title,
        game,
        platform,
        size: Number(size),
        timeframeMins: Number(timeframe),
        format,
        pointsTarget: format === "league" ? Number(pointsTarget) : null,
        stakeWei: stakeWei.toString(),
        stakeChainId: chainId,
        creatorStakeEscrowMatchId,
        creatorWallet: address,
        creatorUsername: profile.username,
      });
      void showBrowserNotification("Tournament created", {
        body: `${created.title} is ready. Share the tournament code with players.`,
        tag: `tournament-created-${created.id}`,
        url: `/tournaments/${encodeURIComponent(created.id)}`,
      });

      router.push(`/tournaments/${created.id}`);
    } catch (createError: unknown) {
      setError(getErrorMessage(createError, "Failed to create tournament."));
    } finally {
      setLockState("idle");
      setSubmitting(false);
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
            Create <span className="text-sky-400">Tournament</span>
          </h1>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link className="border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider sm:text-sm" href="/tournaments">
              Back
            </Link>
            <Link className="border border-sky-500/30 bg-sky-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-sky-300 sm:text-sm" href="/">
              Home
            </Link>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 backdrop-blur-xl">
          <div className="grid gap-6">
            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Tournament Name</label>
              <input
                className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Game</label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {games.map((g) => (
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
                <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Platform</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {platforms.map((p) => (
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
                <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Players</label>
                <select
                  className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                >
                  {[6, 7, 8, 9, 10].map((s) => (
                    <option key={s} value={String(s)}>
                      {s} players
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">
                Entry Stake ({nativeSymbol})
              </label>
              <input
                type="text"
                inputMode="decimal"
                className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
                value={stakeAmount}
                onChange={(event) => setStakeAmount(event.target.value)}
                placeholder="0.02"
              />
              <p className="mt-2 text-xs text-gray-400">
                On create, your wallet is prompted to lock this stake. Every participant joining locks the same amount.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Format</label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(["bracket", "league"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFormat(value)}
                    className={`rounded-2xl border px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${
                      format === value
                        ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
                        : "border-white/10 bg-black/40 text-gray-400 hover:text-white"
                    }`}
                  >
                    {value === "bracket" ? "Bracket (Knockout)" : "League (Points)"}
                  </button>
                ))}
              </div>
            </div>

            {format === "league" && (
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Points Target</label>
                <input
                  type="number"
                  min={10}
                  step={1}
                  className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
                  value={pointsTarget}
                  onChange={(event) => setPointsTarget(event.target.value.replace(/\D/g, ""))}
                />
                <p className="mt-2 text-xs text-gray-400">
                  First player to this points target wins the league.
                </p>
              </div>
            )}

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Match Timeframe</label>
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

            <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-gray-300">
              <div className="text-[10px] uppercase tracking-[0.35em] text-gray-500 mb-3">Payout Table</div>
              <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-gray-500">Pos 1</div>
                  <div className="mt-1 text-sky-300 font-semibold">{payout[0]}%</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-gray-500">Pos 2</div>
                  <div className="mt-1 text-sky-300 font-semibold">{payout[1]}%</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-gray-500">Pos 3</div>
                  <div className="mt-1 text-sky-300 font-semibold">{payout[2]}%</div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={submitting}
              className="w-full rounded-2xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-200"
            >
              {submitting
                ? lockState === "signing"
                  ? "Confirm Stake Lock..."
                  : lockState === "pending"
                    ? "Locking Stake..."
                    : "Creating..."
                : "Create Tournament + Lock Stake"}
            </button>
            {error ? <p className="text-sm text-red-200">{error}</p> : null}
          </div>
        </div>
      </div>
    </main>
  );
}





