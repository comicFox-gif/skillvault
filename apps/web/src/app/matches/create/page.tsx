"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { decodeEventLog, isAddress, parseEther, type Address } from "viem";
import { encodeMatchCode } from "@/lib/matchCode";
import {
  getEscrowAddressForChain,
  getExplorerUrlForChain,
  getNativeSymbolForChain,
  getSupportedChainNames,
  isSupportedChainId,
  supportedChainConfigs,
} from "@/lib/chains";
import { showBrowserNotification } from "@/lib/notifications";
import PageShell from "@/components/PageShell";
import GlassCard from "@/components/GlassCard";

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
  {
    type: "function",
    name: "matches",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "opponent", type: "address" },
      { name: "stake", type: "uint256" },
      { name: "token", type: "address" },
      { name: "createdAt", type: "uint64" },
      { name: "joinedAt", type: "uint64" },
      { name: "joinBy", type: "uint64" },
      { name: "confirmBy", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "creatorPaid", type: "bool" },
      { name: "opponentPaid", type: "bool" },
      { name: "proposedWinner", type: "address" },
    ],
  },
] as const;

const RECEIPT_WAIT_TIMEOUT_MS = 8_000;
const RECEIPT_POLL_INTERVAL_MS = 2_000;
const AUTO_RECHECK_MAX = 120;
const RPC_CALL_TIMEOUT_MS = 6_000;
const CREATE_LOOKBACK_MATCHES = 20n;
const CREATE_TIME_TOLERANCE_SEC = 20 * 60;

type MatchStorageData = readonly [
  Address,
  Address,
  bigint,
  Address,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint | number,
  boolean,
  boolean,
  Address,
];

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Timed out while waiting for network response."));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

const STEP_LABELS = ["Game & Platform", "Stake & Chain", "Settings"] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => {
        const stepNum = i + 1;
        const completed = current > stepNum;
        const active = current === stepNum;
        return (
          <div key={label} className="flex items-center">
            {i > 0 && (
              <div
                className={`h-[2px] w-8 sm:w-14 transition-colors duration-300 ${
                  current > stepNum ? "bg-sky-500" : current === stepNum ? "bg-sky-500/40" : "bg-white/10"
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300 ${
                  completed
                    ? "border-sky-500 bg-sky-500 text-white"
                    : active
                      ? "border-sky-500 bg-sky-500/20 text-sky-300"
                      : "border-white/20 bg-white/5 text-gray-500"
                }`}
              >
                {completed ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  stepNum
                )}
              </div>
              <span
                className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${
                  active ? "text-sky-300" : completed ? "text-sky-400/70" : "text-gray-600"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CreateMatchPage() {
  const router = useRouter();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { switchChainAsync, isPending: switchingChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const escrowAddress = getEscrowAddressForChain(chainId);
  const nativeSymbol = getNativeSymbolForChain(chainId);
  const explorerBaseUrl = getExplorerUrlForChain(chainId).replace(/\/$/, "");
  const preferredChainId = useMemo(() => {
    const configured = supportedChainConfigs.find((chain) => Boolean(chain.escrowAddress));
    return configured?.id ?? supportedChainConfigs[0]?.id ?? chainId;
  }, [chainId]);
  const chainReadyForCreate = Boolean(isSupportedChainId(chainId) && escrowAddress);

  const [step, setStep] = useState(1);

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
  const [pendingStakeWei, setPendingStakeWei] = useState<bigint | null>(null);
  const [pendingOpponent, setPendingOpponent] = useState<Address | null>(null);
  const [autoRechecks, setAutoRechecks] = useState(0);
  const [finalizeStatusText, setFinalizeStatusText] = useState("");
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);
  const [autoRematchRequested, setAutoRematchRequested] = useState(false);
  const [minWinRate, setMinWinRate] = useState("");
  const [switchError, setSwitchError] = useState<string | null>(null);
  const openConnectRef = useRef<(() => void) | null>(null);
  const autoRematchConnectPromptedRef = useRef(false);
  const autoRematchTriggeredRef = useRef(false);
  const createActionLockRef = useRef(false);

  const roomCode = useMemo(() => {
    if (!matchId) return null;
    return encodeMatchCode(matchId);
  }, [matchId]);
  const expectedRoomCode = useMemo(() => {
    if (!expectedMatchId) return null;
    return encodeMatchCode(expectedMatchId);
  }, [expectedMatchId]);
  const provisionalTarget = useMemo(() => {
    if (!expectedRoomCode) return null;
    const timeParam = encodeURIComponent(timeframe);
    const gameParam = encodeURIComponent(game);
    const platformParam = encodeURIComponent(platform);
    const joinParam = encodeURIComponent(joinMins);
    const chainParam = encodeURIComponent(String(chainId));
    const minWrParam = minWinRate && /^\d+$/.test(minWinRate) ? `&mwr=${encodeURIComponent(minWinRate)}` : "";
    return `/matches/${encodeURIComponent(expectedRoomCode)}?t=${timeParam}&g=${gameParam}&p=${platformParam}&j=${joinParam}&c=${chainParam}&pending=1${minWrParam}`;
  }, [expectedRoomCode, timeframe, game, platform, joinMins, chainId, minWinRate]);
  const txExplorerUrl = txHash ? `${explorerBaseUrl}/tx/${txHash}` : null;

  useEffect(() => {
    if (!roomCode) return;
    void showBrowserNotification("Match created", {
      body: `Room #${roomCode} is ready. Share the invite with your opponent.`,
      tag: `match-created-${roomCode}`,
      url: `/matches/${encodeURIComponent(roomCode)}`,
    });
    const timeParam = encodeURIComponent(timeframe);
    const gameParam = encodeURIComponent(game);
    const platformParam = encodeURIComponent(platform);
    const joinParam = encodeURIComponent(joinMins);
    const chainParam = encodeURIComponent(String(chainId));
    const minWrParam = minWinRate && /^\d+$/.test(minWinRate) ? `&mwr=${encodeURIComponent(minWinRate)}` : "";
    const target = `/matches/${encodeURIComponent(roomCode)}?t=${timeParam}&g=${gameParam}&p=${platformParam}&j=${joinParam}&c=${chainParam}&pending=1${minWrParam}`;
    const timeoutId = window.setTimeout(() => {
      router.push(target);
    }, 450);
    return () => window.clearTimeout(timeoutId);
  }, [roomCode, timeframe, game, platform, joinMins, chainId, router]);

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
      setFinalizeStatusText("Auto-checking chain for room code...");
      void resolveMatchId(txHash as `0x${string}`, expectedMatchId, pendingStakeWei, pendingOpponent);
    }, 6000);
    return () => window.clearTimeout(timeoutId);
  }, [txHash, roomCode, checkingReceipt, expectedMatchId, pendingStakeWei, pendingOpponent, autoRechecks]);

  useEffect(() => {
    if (roomCode || createStatus === "idle") {
      createActionLockRef.current = false;
    }
  }, [roomCode, createStatus]);

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

  async function handleSwitchNetwork() {
    setSwitchError(null);
    if (!isConnected) {
      openConnectRef.current?.();
      return;
    }
    try {
      await switchChainAsync({ chainId: preferredChainId });
    } catch (switchErr: any) {
      setSwitchError(
        switchErr?.shortMessage ||
          switchErr?.message ||
          "Failed to switch network automatically. Please switch network in wallet.",
      );
    }
  }

  async function onCreate() {
    if (createActionLockRef.current) return;
    if (creating) return;
    if (txHash && !roomCode) {
      setError("A previous match transaction is still finalizing. Wait, or use Open Provisional Room.");
      return;
    }
    if (!chainReadyForCreate) {
      setError(`Wrong network. Switch wallet to one of: ${getSupportedChainNames()}.`);
      return;
    }
    const activeEscrowAddress = escrowAddress as Address;
    if (!publicClient || !address) {
      setError("Wallet client not ready. Please reconnect wallet and try again.");
      return;
    }
    setError(null);
    setTxHash(null);
    setMatchId(null);
    setPendingStakeWei(null);
    setPendingOpponent(null);
    setAutoRechecks(0);
    setFinalizeStatusText("");
    setLastCheckAt(null);
    setCreating(true);
    setCreateStatus("signing");
    createActionLockRef.current = true;
    let keepActionLocked = false;

    try {
      const [latestNonce, pendingNonce] = await Promise.all([
        publicClient.getTransactionCount({ address, blockTag: "latest" }),
        publicClient.getTransactionCount({ address, blockTag: "pending" }),
      ]);
      if (pendingNonce > latestNonce) {
        throw new Error("You have a pending wallet transaction. In MetaMask, Speed Up or Cancel it first.");
      }

      const bytecode = await publicClient.getBytecode({ address: activeEscrowAddress });
      if (!bytecode || bytecode === "0x") {
        throw new Error(
          `Escrow contract not found on this network (chainId=${chainId}) at ${activeEscrowAddress}. Deploy escrow for this chain and update per-chain escrow env.`,
        );
      }
      const nextId = await withTimeout(
        publicClient.readContract({
          address: activeEscrowAddress,
          abi: escrowAbi,
          functionName: "nextMatchId",
          args: [],
        }),
        RPC_CALL_TIMEOUT_MS,
      );
      const expectedId = typeof nextId === "bigint" ? nextId.toString() : null;
      setExpectedMatchId(expectedId);
      const stakeWei = parseEther(stakeEth || "0");
      setPendingStakeWei(stakeWei);
      setPendingOpponent(opponentAddress);
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
        address: activeEscrowAddress,
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
      keepActionLocked = true;
      setFinalizeStatusText("Transaction submitted. Waiting for chain confirmation...");
      if (expectedId) {
        // Move user forward immediately; room page will continue reading live chain state.
        setMatchId(expectedId);
      } else {
        setFinalizeStatusText("Transaction confirmed. Resolving room code...");
        void resolveMatchId(hash, expectedId, stakeWei, opponentAddress);
      }
    } catch (e: any) {
      const message = e?.shortMessage || e?.message || String(e);
      if (String(message).toLowerCase().includes("transaction already imported")) {
        setError(
          "Transaction already imported by RPC. Check wallet activity for pending tx, then use Open Provisional Room.",
        );
        setCreateStatus("idle");
        setFinalizeStatusText("");
      } else {
        setError(message);
        setCreateStatus("idle");
        setPendingStakeWei(null);
        setPendingOpponent(null);
        setFinalizeStatusText("");
      }
    } finally {
      setCreating(false);
      if (!keepActionLocked) {
        createActionLockRef.current = false;
      }
    }
  }

  async function resolveMatchId(
    hash: `0x${string}`,
    expectedId: string | null,
    stakeWei: bigint | null,
    opponent: Address | null,
  ) {
    if (!publicClient) {
      setError("Wallet client disconnected. Reconnect wallet, then click Check Again.");
      return;
    }
    if (checkingReceipt) return;
    setCheckingReceipt(true);
    setLastCheckAt(Date.now());
    setFinalizeStatusText("Checking transaction receipt...");
    let resolved = false;
    try {
      let latestHash = hash;
      let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>> | null = null;
      try {
        receipt = await withTimeout(publicClient.getTransactionReceipt({ hash }), RPC_CALL_TIMEOUT_MS);
      } catch {
        // continue
      }
      if (!receipt) {
        try {
          setFinalizeStatusText("Waiting for block confirmation...");
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
          // fall through to lightweight fallbacks
        }
      }

      if (receipt) {
        if (receipt.status === "reverted") {
          setError("Transaction reverted on-chain. Check stake amount and retry.");
          setFinalizeStatusText("");
          setCreateStatus("idle");
          return;
        }
        const matchedId = extractMatchIdFromReceipt(receipt);
        if (matchedId) {
          setMatchId(matchedId);
          setError(null);
          setFinalizeStatusText("Room ready. Redirecting...");
          resolved = true;
        } else if (expectedId) {
          // Receipt is confirmed but event parsing can fail on some RPC/indexers.
          // Use the pre-read nextMatchId snapshot as deterministic fallback.
          setMatchId(expectedId);
          setError(null);
          setFinalizeStatusText("Confirmed. Finalizing room...");
          resolved = true;
        }
      } else if (latestHash !== hash) {
        setTxHash(latestHash);
      }

      if (!resolved) setFinalizeStatusText("Receipt not indexed yet. Checking next match id...");
      if (!resolved && expectedId) resolved = await pollNextMatchId(expectedId);
      if (!resolved) setFinalizeStatusText("Checking creator snapshot...");
      if (!resolved && expectedId && address) resolved = await pollMatchByCreator(expectedId, address);
      if (!resolved) setFinalizeStatusText("Scanning latest matches...");
      if (!resolved && address && typeof stakeWei === "bigint" && opponent) {
        const discovered = await findRecentCreatedMatchId(address, opponent, stakeWei, expectedId);
        if (discovered) {
          setMatchId(discovered);
          setError(null);
          setFinalizeStatusText("Room resolved from latest matches.");
          resolved = true;
        }
      }
      if (!resolved) {
        setError("Transaction is still pending. Click Check Again in a few seconds.");
        setFinalizeStatusText("Still pending. Auto-check will continue...");
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
    try {
      const nextId = await withTimeout(
        publicClient.readContract({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "nextMatchId",
          args: [],
        }),
        RPC_CALL_TIMEOUT_MS,
      );
      if (typeof nextId === "bigint" && nextId > expected) {
        setMatchId(expectedId);
        setError(null);
        return true;
      }
    } catch {
      // ignore transient RPC read errors; auto-check will retry
    }
    return false;
  }

  async function pollMatchByCreator(expectedId: string, creatorAddress: Address) {
    if (!publicClient || !escrowAddress) return false;
    const expected = BigInt(expectedId);
    const creatorLower = creatorAddress.toLowerCase();
    try {
      const row = (await withTimeout(
        publicClient.readContract({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "getMatch",
          args: [expected],
        }),
        RPC_CALL_TIMEOUT_MS,
      )) as readonly [Address, Address, bigint, bigint, bigint | number, boolean, boolean, Address];
      const creator = row?.[0];
      if (creator && creator.toLowerCase() === creatorLower) {
        setMatchId(expectedId);
        setError(null);
        return true;
      }
    } catch {
      // ignore transient RPC read errors; auto-check will retry
    }
    return false;
  }

  async function findRecentCreatedMatchId(
    creatorAddress: Address,
    opponentAddress: Address,
    stakeAmount: bigint,
    expectedId: string | null,
  ): Promise<string | null> {
    if (!publicClient || !escrowAddress) return null;
    let nextId: bigint;
    try {
      const value = await withTimeout(
        publicClient.readContract({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "nextMatchId",
          args: [],
        }),
        RPC_CALL_TIMEOUT_MS,
      );
      if (typeof value !== "bigint" || value === 0n) return null;
      nextId = value;
    } catch {
      return null;
    }

    const creatorLower = creatorAddress.toLowerCase();
    const opponentLower = opponentAddress.toLowerCase();
    const nowSec = Math.floor(Date.now() / 1000);
    const minCreatedAt = Math.max(0, nowSec - CREATE_TIME_TOLERANCE_SEC);
    const startId =
      expectedId && /^\d+$/.test(expectedId)
        ? BigInt(expectedId)
        : (nextId > 0n ? nextId - 1n : 0n);
    const stopByLookback = nextId > CREATE_LOOKBACK_MATCHES ? nextId - CREATE_LOOKBACK_MATCHES : 0n;
    const stopId = stopByLookback < startId ? stopByLookback : startId;

    let cursor = nextId > 0n ? nextId - 1n : 0n;
    while (cursor >= stopId) {
      try {
        const row = (await withTimeout(
          publicClient.readContract({
            address: escrowAddress,
            abi: escrowAbi,
            functionName: "matches",
            args: [cursor],
          }),
          RPC_CALL_TIMEOUT_MS,
        )) as MatchStorageData;
        const rowCreator = row?.[0]?.toLowerCase();
        const rowOpponent = row?.[1]?.toLowerCase();
        const rowStake = row?.[2];
        const rowCreatedAt = row?.[4];
        const createdAtSec =
          typeof rowCreatedAt === "bigint"
            ? Number(rowCreatedAt)
            : typeof rowCreatedAt === "number"
              ? rowCreatedAt
              : 0;
        if (
          rowCreator === creatorLower &&
          rowOpponent === opponentLower &&
          rowStake === stakeAmount &&
          createdAtSec >= minCreatedAt
        ) {
          return cursor.toString();
        }
      } catch {
        // keep scanning
      }
      if (cursor === 0n) break;
      cursor -= 1n;
    }
    return null;
  }

  /* ─── wizard step content ─── */

  const stepOneContent = (
    <div className="grid gap-5">
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

      <div>
        <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Platform</label>
        <div className="grid grid-cols-3 gap-2">
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
    </div>
  );

  const stepTwoContent = (
    <div className="grid gap-5">
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

      {!chainReadyForCreate && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-100">
          <div className="font-bold uppercase tracking-wider">Wrong network for match escrow.</div>
          <div className="mt-1">Switch wallet to the required chain before creating a match.</div>
          <button
            type="button"
            onClick={() => void handleSwitchNetwork()}
            disabled={switchingChain}
            className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 disabled:opacity-60"
          >
            {switchingChain ? "Switching..." : "Switch Network"}
          </button>
          {switchError ? <div className="mt-2 text-[11px] text-red-200">{switchError}</div> : null}
        </div>
      )}
    </div>
  );

  const stepThreeContent = (
    <div className="grid gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Join Deadline (Mins)</label>
          <input
            className="w-full border border-white/10 bg-black/50 p-4 text-white outline-none focus:border-sky-500"
            value={joinMins}
            onChange={(e) => setJoinMins(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">
            Min Opponent Win Rate (optional)
          </label>
          <div className="flex items-center gap-3">
            <input
              className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
              type="number"
              min="0"
              max="100"
              placeholder="e.g. 40"
              value={minWinRate}
              onChange={(e) => setMinWinRate(e.target.value)}
            />
            <span className="text-sm text-gray-400">%</span>
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-widest text-gray-600">
            Leave empty for no restriction. Opponents below this win rate cannot join.
          </p>
        </div>
      </div>
    </div>
  );

  const reviewContent = (
    <div className="grid gap-4">
      <div className="text-xs uppercase tracking-[0.3em] text-gray-500 mb-1">Review Your Match</div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Game</div>
          <div className="font-bold text-white">{game}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Platform</div>
          <div className="font-bold text-white">{platform}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Stake</div>
          <div className="font-bold text-white">{stakeEth} {nativeSymbol}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Timeframe</div>
          <div className="font-bold text-white">{timeframe} min</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Join Deadline</div>
          <div className="font-bold text-white">{joinMins} min</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Min Win Rate</div>
          <div className="font-bold text-white">{minWinRate ? `${minWinRate}%` : "None"}</div>
        </div>
      </div>

      <ConnectButton.Custom>
        {({ openConnectModal }) => (
          <button
            className="btn-ripple btn-press mt-2 w-full rounded-2xl border border-sky-500/40 bg-sky-500/20 p-4 text-xs font-bold uppercase tracking-wider text-sky-100 transition-all hover:bg-sky-500/30 hover:shadow-[0_0_30px_rgba(56,189,248,0.15)] disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
            onClick={(e) => {
              if (!isConnected) {
                openConnectRef.current = openConnectModal;
                openConnectModal();
                return;
              }
              void onCreate();
            }}
            disabled={!chainReadyForCreate || creating || createStatus === "pending" || Boolean(txHash && !roomCode)}
          >
            <span className="inline-flex items-center justify-center gap-2.5">
              {creating || (txHash && !roomCode) ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              )}
              {creating ? "Creating Match..." : txHash && !roomCode ? "Finalizing..." : "Initialize Match"}
            </span>
          </button>
        )}
      </ConnectButton.Custom>

      {createStatus !== "idle" && (
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3 text-xs text-sky-200 animate-fade-in-up">
          <span className="inline-flex items-center gap-2">
            <svg className="h-4 w-4 animate-spin-slow" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {createStatus === "signing"
              ? "Waiting for wallet confirmation..."
              : "Transaction sent, waiting for confirmation..."}
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400 font-mono break-all">
          {error}
        </div>
      )}
    </div>
  );

  const sidebarContent = (
    <aside>
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
  );

  return (
    <PageShell maxWidth="max-w-6xl">
      <ConnectButton.Custom>
        {({ openConnectModal }) => {
          openConnectRef.current = openConnectModal;
          return null;
        }}
      </ConnectButton.Custom>

      <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white sm:text-4xl">
          Create <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-sky-200">Match</span>
        </h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
        <div className="lg:col-span-3 lg:pr-2">
          <GlassCard glow hover={false}>
            <StepIndicator current={step} />

            {step === 1 && stepOneContent}
            {step === 2 && stepTwoContent}
            {step === 3 && stepThreeContent}
            {step === 4 && reviewContent}

            {/* Navigation buttons */}
            <div className="mt-6 flex items-center justify-between gap-3">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-white/10"
                >
                  Back
                </button>
              ) : (
                <div />
              )}
              {step < 4 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => s + 1)}
                  className="rounded-2xl border border-sky-500/40 bg-sky-500/20 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-sky-100 transition-all hover:bg-sky-500/30"
                >
                  Next
                </button>
              )}
            </div>
          </GlassCard>
        </div>

        <div className="lg:col-span-2 lg:pl-1">
          {sidebarContent}
        </div>
      </div>

      {/* Finalizing modal */}
      {!roomCode && txHash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-sky-500/30 bg-slate-900/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-6">
            <div className="mb-4 text-xs uppercase tracking-[0.35em] text-sky-400/80">Match Created</div>
            <h3 className="text-2xl font-semibold text-white">Finalizing match...</h3>
              <p className="mt-2 text-sm text-gray-400">
                We sent the transaction. Waiting for confirmation to fetch your room code.
              </p>
              {finalizeStatusText ? (
                <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                  {finalizeStatusText}
                </div>
              ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {txHash && (
                <button
                  className="flex-1 rounded-2xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-200"
                  onClick={() =>
                    void resolveMatchId(
                      txHash as `0x${string}`,
                      expectedMatchId,
                      pendingStakeWei,
                      pendingOpponent,
                    )
                  }
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
                  setExpectedMatchId(null);
                  setPendingStakeWei(null);
                  setPendingOpponent(null);
                  setCreateStatus("idle");
                  setCheckingReceipt(false);
                  setFinalizeStatusText("");
                  setLastCheckAt(null);
                  createActionLockRef.current = false;
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
                    onClick={() => {
                      if (!provisionalTarget) return;
                      router.push(provisionalTarget);
                    }}
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
                {lastCheckAt ? (
                  <div className="text-[10px] text-gray-500">
                    Last checked: {new Date(lastCheckAt).toLocaleTimeString()}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
