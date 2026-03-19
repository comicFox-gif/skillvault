"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog, isAddress, parseEther, type Address } from "viem";
import { encodeMatchCode } from "@/lib/matchCode";
import {
  getEscrowAddressForChain,
  getExplorerUrlForChain,
  getNativeSymbolForChain,
  getSupportedChainNames,
  isSupportedChainId,
} from "@/lib/chains";

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
] as const;

const RECEIPT_WAIT_TIMEOUT_MS = 120_000;
const NEXT_ID_POLL_TRIES = 30;
const NEXT_ID_POLL_INTERVAL_MS = 1_000;
const RECEIPT_POLL_INTERVAL_MS = 2_000;
const AUTO_RECHECK_MAX = 120;
const CREATOR_MATCH_POLL_TRIES = 45;
const CREATOR_MATCH_POLL_INTERVAL_MS = 2_000;

export default function CreateMatchPage() {
  const router = useRouter();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const escrowAddress = getEscrowAddressForChain(chainId);
  const nativeSymbol = getNativeSymbolForChain(chainId);
  const explorerBaseUrl = getExplorerUrlForChain(chainId).replace(/\/$/, "");

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
  const [autoRechecks, setAutoRechecks] = useState(0);
  const [autoRematchRequested, setAutoRematchRequested] = useState(false);
  const openConnectRef = useRef<(() => void) | null>(null);
  const autoRematchConnectPromptedRef = useRef(false);
  const autoRematchTriggeredRef = useRef(false);

  const roomCode = useMemo(() => {
    if (!matchId) return null;
    return encodeMatchCode(matchId);
  }, [matchId]);
  const expectedRoomCode = useMemo(() => {
    if (!expectedMatchId) return null;
    return encodeMatchCode(expectedMatchId);
  }, [expectedMatchId]);
  const txExplorerUrl = txHash ? `${explorerBaseUrl}/tx/${txHash}` : null;

  useEffect(() => {
    if (!roomCode) return;
    const timeParam = encodeURIComponent(timeframe);
    const gameParam = encodeURIComponent(game);
    const platformParam = encodeURIComponent(platform);
    const joinParam = encodeURIComponent(joinMins);
    const target = `/matches/${encodeURIComponent(roomCode)}?t=${timeParam}&g=${gameParam}&p=${platformParam}&j=${joinParam}`;
    const timeoutId = window.setTimeout(() => {
      router.push(target);
    }, 450);
    return () => window.clearTimeout(timeoutId);
  }, [roomCode, timeframe, game, platform, joinMins, router]);

  useEffect(() => {
    if (prefillApplied) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const stakeParam = params.get("stake");
    const timeframeParam = params.get("timeframe");
    const opponentParam = params.get("opponent");
    const joinParam = params.get("joinMins");
    const gameParam = params.get("game");
    const platformParam = params.get("platform");
    const autoRematchParam = params.get("autorematch");

    if (stakeParam) setStakeEth(stakeParam);
    if (timeframeParam && /^\d+$/.test(timeframeParam)) setTimeframe(timeframeParam);
    if (opponentParam && isAddress(opponentParam)) setOpponentAddress(opponentParam);
    if (joinParam && /^\d+$/.test(joinParam)) setJoinMins(joinParam);
    if (gameParam === "eFootball" || gameParam === "FC26" || gameParam === "FC25" || gameParam === "Mortal Kombat") {
      setGame(gameParam);
    }
    if (platformParam === "Console" || platformParam === "PC" || platformParam === "Mobile") {
      setPlatform(platformParam);
    }
    if (autoRematchParam === "1") {
      setAutoRematchRequested(true);
    }

    setPrefillApplied(true);
  }, [prefillApplied]);

  useEffect(() => {
    setConfirmMins(timeframe);
  }, [timeframe]);

  useEffect(() => {
    if (!txHash || roomCode || checkingReceipt) return;
    if (autoRechecks >= AUTO_RECHECK_MAX) return;
    const timeoutId = window.setTimeout(() => {
      setAutoRechecks((count) => count + 1);
      void resolveMatchId(txHash as `0x${string}`, expectedMatchId);
    }, 6000);
    return () => window.clearTimeout(timeoutId);
  }, [txHash, roomCode, checkingReceipt, expectedMatchId, autoRechecks]);

  useEffect(() => {
    if (!matchId || typeof window === "undefined") return;
    const meta = {
      game,
      platform,
      timeframe: Number(timeframe),
      joinMins: Number(joinMins),
      createdAt: Date.now(),
    };
    window.localStorage.setItem(`match-meta:${matchId}`, JSON.stringify(meta));
  }, [matchId, game, platform, timeframe, joinMins]);

  useEffect(() => {
    if (!prefillApplied || !autoRematchRequested) return;
    if (roomCode || txHash || creating || createStatus !== "idle") return;

    if (!isConnected) {
      if (!autoRematchConnectPromptedRef.current) {
        autoRematchConnectPromptedRef.current = true;
        openConnectRef.current?.();
      }
      return;
    }

    if (autoRematchTriggeredRef.current) return;
    autoRematchTriggeredRef.current = true;
    void onCreate();
  }, [prefillApplied, autoRematchRequested, roomCode, txHash, creating, createStatus, isConnected]);

  async function onCreate() {
    if (creating) return;
    if (!isSupportedChainId(chainId)) {
      setError(`Unsupported network. Switch wallet to one of: ${getSupportedChainNames()}.`);
      return;
    }
    if (!escrowAddress) {
      setError("Escrow address is missing for this network. Configure per-chain escrow env variables.");
      return;
    }
    if (!publicClient || !address) {
      setError("Wallet client not ready. Please reconnect wallet and try again.");
      return;
    }
    setError(null);
    setTxHash(null);
    setMatchId(null);
    setAutoRechecks(0);
    setCreating(true);
    setCreateStatus("signing");

    try {
      const [latestNonce, pendingNonce] = await Promise.all([
        publicClient.getTransactionCount({ address, blockTag: "latest" }),
        publicClient.getTransactionCount({ address, blockTag: "pending" }),
      ]);
      if (pendingNonce > latestNonce) {
        throw new Error("You have a pending wallet transaction. In MetaMask, Speed Up or Cancel it first.");
      }

      const bytecode = await publicClient.getBytecode({ address: escrowAddress });
      if (!bytecode || bytecode === "0x") {
        throw new Error(
          `Escrow contract not found on this network (chainId=${chainId}) at ${escrowAddress}. Deploy escrow for this chain and update per-chain escrow env.`,
        );
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
      const feeOverrides: {
        gasPrice?: bigint;
        maxFeePerGas?: bigint;
        maxPriorityFeePerGas?: bigint;
      } = {};
      try {
        const estimated = await publicClient.estimateFeesPerGas();
        if (estimated.maxFeePerGas && estimated.maxPriorityFeePerGas) {
          feeOverrides.maxFeePerGas = estimated.maxFeePerGas * 2n;
          feeOverrides.maxPriorityFeePerGas = estimated.maxPriorityFeePerGas * 2n;
        } else if (estimated.gasPrice) {
          feeOverrides.gasPrice = estimated.gasPrice * 2n;
        }
      } catch {
        // fallback to wallet defaults if fee estimation is unavailable
      }
      const request: any = {
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "createMatch",
        args: [opponentAddress, stakeWei, joinBySeconds, confirmBySeconds] as const,
        value: stakeWei,
      };
      if (feeOverrides.maxFeePerGas && feeOverrides.maxPriorityFeePerGas) {
        request.maxFeePerGas = feeOverrides.maxFeePerGas;
        request.maxPriorityFeePerGas = feeOverrides.maxPriorityFeePerGas;
      } else if (feeOverrides.gasPrice) {
        request.gasPrice = feeOverrides.gasPrice;
      }

      const hash = await writeContractAsync(request);

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
    if (!publicClient) {
      setError("Wallet client disconnected. Reconnect wallet, then click Check Again.");
      return;
    }
    if (checkingReceipt) return;
    setCheckingReceipt(true);
    let resolved = false;
    try {
      let latestHash = hash;
      let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>> | null = null;
      try {
        receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: RECEIPT_WAIT_TIMEOUT_MS,
          pollingInterval: RECEIPT_POLL_INTERVAL_MS,
          onReplaced: (replacement) => {
            const replacedHash = replacement.transaction.hash;
            if (!replacedHash) return;
            latestHash = replacedHash;
            setTxHash(replacedHash);
          },
        });
      } catch {
        // fall through to nextMatchId polling fallback
      }

      if (receipt) {
        if (receipt.status === "reverted") {
          setError("Transaction reverted on-chain. Check stake amount and retry.");
          return;
        }
        const matchedId = extractMatchIdFromReceipt(receipt);
        if (matchedId) {
          setMatchId(matchedId);
          setError(null);
          resolved = true;
        } else if (expectedId) {
          // Receipt is confirmed but event parsing can fail on some RPC/indexers.
          // Use the pre-read nextMatchId snapshot as deterministic fallback.
          setMatchId(expectedId);
          setError(null);
          resolved = true;
        }
      } else if (latestHash !== hash) {
        setTxHash(latestHash);
      }

      if (!resolved && expectedId) {
        resolved = await pollNextMatchId(expectedId);
      }
      if (!resolved && expectedId && address) {
        resolved = await pollMatchByCreator(expectedId, address);
      }
      if (!resolved) {
        setError("Transaction is still pending. Click Check Again in a few seconds.");
      }
    } finally {
      setCheckingReceipt(false);
    }
  }

  function extractMatchIdFromReceipt(receipt: any) {
    const escrowAddrLower = escrowAddress?.toLowerCase();
    if (!escrowAddrLower) return null;
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
            return id.toString();
          }
        }
      } catch {
        // ignore non-matching logs
      }
    }
    return null;
  }

  async function pollNextMatchId(expectedId: string) {
    if (!publicClient || !escrowAddress) return false;
    const expected = BigInt(expectedId);
    for (let i = 0; i < NEXT_ID_POLL_TRIES; i += 1) {
      try {
        const nextId = await publicClient.readContract({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "nextMatchId",
          args: [],
        });
        if (typeof nextId === "bigint" && nextId > expected) {
          setMatchId(expectedId);
          setError(null);
          return true;
        }
      } catch {
        // ignore transient RPC read errors and retry
      }
      await new Promise((resolve) => setTimeout(resolve, NEXT_ID_POLL_INTERVAL_MS));
    }
    return false;
  }

  async function pollMatchByCreator(expectedId: string, creatorAddress: Address) {
    if (!publicClient || !escrowAddress) return false;
    const expected = BigInt(expectedId);
    const creatorLower = creatorAddress.toLowerCase();
    for (let i = 0; i < CREATOR_MATCH_POLL_TRIES; i += 1) {
      try {
        const row = (await publicClient.readContract({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "getMatch",
          args: [expected],
        })) as readonly [Address, Address, bigint, bigint, bigint | number, boolean, boolean, Address];
        const creator = row?.[0];
        if (creator && creator.toLowerCase() === creatorLower) {
          setMatchId(expectedId);
          setError(null);
          return true;
        }
      } catch {
        // keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, CREATOR_MATCH_POLL_INTERVAL_MS));
    }
    return false;
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

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
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

        <ConnectButton.Custom>
          {({ openConnectModal }) => {
            openConnectRef.current = openConnectModal;
            return null;
          }}
        </ConnectButton.Custom>

        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(59,130,246,0.12),transparent_45%)]" />
          <div className="relative rounded-[22px] bg-slate-900/90 p-5 backdrop-blur-xl sm:p-6 lg:p-7">
            <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
              <div className="grid gap-5 lg:col-span-3 lg:pr-2">
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    className="mt-2 w-full rounded-2xl border border-sky-500/40 bg-sky-500/20 p-4 text-xs font-bold uppercase tracking-wider text-sky-100 transition-all hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
                    onClick={() => {
                      if (!isConnected) {
                        openConnectRef.current = openConnectModal;
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
              {createStatus !== "idle" && (
                <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3 text-xs text-sky-200">
                  {createStatus === "signing"
                    ? "Waiting for wallet confirmation..."
                    : "Transaction sent, waiting for confirmation..."}
                </div>
              )}

              {error && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400 font-mono break-all">
                  {error}
                </div>
              )}
              </div>

              <aside className="lg:col-span-2 lg:pl-1">
                <div className="rounded-2xl border border-white/10 bg-black/50 p-4 text-xs text-gray-300">
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
              </aside>
            </div>

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
                        onClick={() => void resolveMatchId(txHash as `0x${string}`, expectedMatchId)}
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
                    <div className="mt-4 space-y-2">
                      <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">
                        Transaction submitted
                      </div>
                      {txExplorerUrl && (
                        <a
                          href={txExplorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-200 hover:bg-sky-500/20"
                        >
                          Open In Explorer
                        </a>
                      )}
                      {expectedRoomCode && (
                        <button
                          type="button"
                          className="ml-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-white/10"
                          onClick={() => router.push(`/matches/${encodeURIComponent(expectedRoomCode)}?t=${encodeURIComponent(timeframe)}`)}
                        >
                          Open Provisional Room
                        </button>
                      )}
                      <div className="text-[11px] text-amber-200/90">
                        If pending for too long, use MetaMask Speed Up or Cancel, then retry.
                      </div>
                      <div className="text-[10px] text-gray-400">
                        Auto-check attempts: {Math.min(autoRechecks, AUTO_RECHECK_MAX)}/{AUTO_RECHECK_MAX}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}





