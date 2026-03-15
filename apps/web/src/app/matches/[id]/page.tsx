"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, use } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { formatEther, zeroAddress, type Address } from "viem";
import { decodeMatchCode, encodeMatchCode } from "@/lib/matchCode";

const escrowAbi = [
  // views
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

  // actions
  { type: "function", name: "joinMatch", stateMutability: "payable", inputs: [{ name: "matchId", type: "uint256" }], outputs: [] },
  { type: "function", name: "proposeWinner", stateMutability: "nonpayable", inputs: [{ name: "matchId", type: "uint256" }, { name: "winner", type: "address" }], outputs: [] },
  { type: "function", name: "confirmWinner", stateMutability: "nonpayable", inputs: [{ name: "matchId", type: "uint256" }], outputs: [] },
  { type: "function", name: "forfeit", stateMutability: "nonpayable", inputs: [{ name: "matchId", type: "uint256" }], outputs: [] },
  { type: "function", name: "dispute", stateMutability: "nonpayable", inputs: [{ name: "matchId", type: "uint256" }], outputs: [] },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "matchId", type: "uint256" }], outputs: [] },
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
type HistoryResult = "Win" | "Loss" | "Pending" | "Disputed";
type HistoryEntry = {
  matchId: string;
  opponent: Address;
  result: HistoryResult;
};
type WalletHistory = {
  wins: number;
  losses: number;
  resolved: number;
  disputes: number;
  noResponseFlags: number;
  entries: HistoryEntry[];
};

export default function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const walletBalanceQuery = useBalance({
    address,
    query: { enabled: Boolean(isConnected && address) },
  });
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  type BaseWriteConfig = Parameters<typeof writeContractAsync>[0];
  type WriteConfig = Omit<BaseWriteConfig, "value" | "nonce"> & {
    value?: bigint;
    nonce?: number;
  };
  const escrowAddress = process.env.NEXT_PUBLIC_MATCH_ESCROW_ADDRESS as `0x${string}` | undefined;
  const nativeSymbol = process.env.NEXT_PUBLIC_NATIVE_SYMBOL || "DEV";

  const decodedMatchId = useMemo(() => decodeMatchCode(id), [id]);
  const hasValidRoomCode = decodedMatchId !== null;
  const matchId = decodedMatchId ?? 0n;
  const roomCode = useMemo(() => encodeMatchCode(matchId), [matchId]);

  const matchQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getMatch",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress && hasValidRoomCode), refetchInterval: 2000 },
  });
  const matchStorageQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "matches",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress && hasValidRoomCode), refetchInterval: 2000 },
  });
  const creatorVoteQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "creatorReportedWinner",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress && hasValidRoomCode), refetchInterval: 2000 },
  });
  const opponentVoteQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "opponentReportedWinner",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress && hasValidRoomCode), refetchInterval: 2000 },
  });

  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [joinedNotice, setJoinedNotice] = useState(false);
  const [cancelCountdown, setCancelCountdown] = useState<number | null>(null);
  const [showLoseConfirm, setShowLoseConfirm] = useState(false);
  const [showDisputeConfirm, setShowDisputeConfirm] = useState(false);
  const [showAwaitingOpponent, setShowAwaitingOpponent] = useState(false);
  const [historyByWallet, setHistoryByWallet] = useState<Record<string, WalletHistory>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [autoJoinTriggered, setAutoJoinTriggered] = useState(false);
  const [joinAfterConnect, setJoinAfterConnect] = useState(false);
  const [isOutcomeSubmitting, setIsOutcomeSubmitting] = useState(false);
  const [copiedRoomCode, setCopiedRoomCode] = useState(false);
  const [copiedMatchLink, setCopiedMatchLink] = useState(false);
  const openConnectRef = useRef<(() => void) | null>(null);

  const data = matchQuery.data as MatchData | undefined;
  const rawStorage = matchStorageQuery.data as MatchStorageData | undefined;
  const creator = data?.[0];
  const opponent = data?.[1];
  const stake = data?.[2];
  const joinedAt = data?.[3];
  const status = data?.[4];
  const creatorPaid = data?.[5];
  const opponentPaid = data?.[6];
  const proposedWinner = data?.[7];
  const creatorVote = creatorVoteQuery.data as Address | undefined;
  const opponentVote = opponentVoteQuery.data as Address | undefined;

  const isCreator = Boolean(address && creator && address.toLowerCase() === creator.toLowerCase());
  const isOpponent = Boolean(address && opponent && address.toLowerCase() === opponent.toLowerCase());
  const isPlayer = Boolean(isCreator || isOpponent);
  const matchExists = Boolean(creator && creator.toLowerCase() !== zeroAddress);
  const canDeclare = Boolean(isCreator || isOpponent);
  const opponentAddressForLoss = isCreator ? opponent : isOpponent ? creator : undefined;
  const normalizedProposedWinner =
    proposedWinner && proposedWinner.toLowerCase() !== zeroAddress ? proposedWinner : undefined;

  const stakeValue = typeof stake === "bigint" ? stake : typeof stake === "number" ? BigInt(stake) : undefined;
  const stakeEth = typeof stake === "bigint" ? formatEther(stake) : "-";
  const statusNum =
    typeof status === "bigint" ? Number(status) : typeof status === "number" ? status : undefined;
  const statusText = typeof statusNum === "number" ? (STATUS[statusNum] ?? `Unknown(${statusNum})`) : "-";
  const matchLoaded = Boolean(data);
  const canJoin = Boolean(matchExists && !isCreator && statusNum === 0 && !opponentPaid);
  const autoJoinEligible = Boolean(
    matchExists &&
      !isCreator &&
      statusNum === 0 &&
      !opponentPaid &&
      typeof stakeValue === "bigint"
  );
  const autoJoinRequested = searchParams.get("auto") === "1";
  const canSelectOutcome = Boolean(
    (statusNum === 2 || statusNum === 3) && cancelCountdown === 0
  );
  const hasSubmittedOutcome = Boolean(
    (isCreator && creatorVote && creatorVote.toLowerCase() !== zeroAddress) ||
      (isOpponent && opponentVote && opponentVote.toLowerCase() !== zeroAddress),
  );
  const awaitingAcceptOrDispute = Boolean(
    canSelectOutcome &&
      canDeclare &&
      statusNum === 3 &&
      normalizedProposedWinner &&
      address &&
      normalizedProposedWinner.toLowerCase() !== address.toLowerCase(),
  );
  const totalStake = typeof stakeValue === "bigint" ? stakeValue * 2n : null;
  const winnerPayout =
    typeof totalStake === "bigint" ? totalStake - (totalStake * 200n) / 10000n : null;
  const totalStakeText =
    typeof totalStake === "bigint"
      ? Number(formatEther(totalStake)).toLocaleString(undefined, { maximumFractionDigits: 6 })
      : null;
  const winnerPayoutText =
    typeof winnerPayout === "bigint"
      ? Number(formatEther(winnerPayout)).toLocaleString(undefined, { maximumFractionDigits: 6 })
      : null;
  const confirmByRaw = rawStorage?.[7];
  const timeoutSecondsLeft =
    statusNum === 3 && typeof confirmByRaw === "bigint"
      ? Math.max(0, Math.floor((Number(confirmByRaw) * 1000 - nowMs) / 1000))
      : null;
  const invitePath = useMemo(() => {
    if (!hasValidRoomCode) return "";
    const params = new URLSearchParams();
    const timeframeParam = searchParams.get("t");
    if (timeframeParam && /^\d+$/.test(timeframeParam)) {
      params.set("t", timeframeParam);
    }
    params.set("auto", "1");
    const query = params.toString();
    return `/matches/${encodeURIComponent(roomCode)}${query ? `?${query}` : ""}`;
  }, [hasValidRoomCode, roomCode, searchParams]);
  const inviteLinkPreview = invitePath || "-";

  function shortAddress(value?: string) {
    if (!value) return "-";
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  async function copyRoomCodeValue() {
    if (!hasValidRoomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedRoomCode(true);
      setTimeout(() => setCopiedRoomCode(false), 1200);
    } catch {
      setCopiedRoomCode(false);
    }
  }

  async function copyMatchLinkValue() {
    if (!invitePath) return;
    try {
      const fullUrl =
        typeof window !== "undefined" ? `${window.location.origin}${invitePath}` : invitePath;
      await navigator.clipboard.writeText(fullUrl);
      setCopiedMatchLink(true);
      setTimeout(() => setCopiedMatchLink(false), 1200);
    } catch {
      setCopiedMatchLink(false);
    }
  }

  const rematchHref = useMemo(() => {
    if (typeof stakeValue !== "bigint") return "/matches/create";

    const params = new URLSearchParams();
    params.set("stake", formatEther(stakeValue));

    const timeframeParam = searchParams.get("t");
    if (timeframeParam && /^\d+$/.test(timeframeParam)) {
      params.set("timeframe", timeframeParam);
    }

    const rematchOpponent = isCreator ? opponent : isOpponent ? creator : undefined;
    if (rematchOpponent && rematchOpponent.toLowerCase() !== zeroAddress) {
      params.set("opponent", rematchOpponent);
    }

    return `/matches/create?${params.toString()}`;
  }, [stakeValue, searchParams, isCreator, isOpponent, opponent, creator]);
  const showPostMatchActions = Boolean(statusNum === 5 && isPlayer);

  async function runTx(
    fn: () => Promise<`0x${string}`>,
    onSuccess?: (hash: `0x${string}`) => void,
  ) {
    setErr(null);
    setTxHash(null);
    try {
      const hash = await fn();
      setTxHash(hash);
      onSuccess?.(hash);
      setTimeout(() => {
        matchQuery.refetch();
        matchStorageQuery.refetch();
        loadWalletHistories();
      }, 600);
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
    }
  }

  async function writeWithNonce(config: WriteConfig) {
    if (!publicClient || !address) {
      return writeContractAsync(config as Parameters<typeof writeContractAsync>[0]);
    }
    const nonce = Number(await publicClient.getTransactionCount({ address, blockTag: "latest" }));
    return writeContractAsync({ ...config, nonce } as Parameters<typeof writeContractAsync>[0]);
  }

  async function loadWalletHistories() {
    if (!publicClient || !escrowAddress) return;

    const trackedWallets = [creator, opponent]
      .filter((wallet): wallet is Address => Boolean(wallet && wallet.toLowerCase() !== zeroAddress))
      .map((wallet) => wallet.toLowerCase());

    if (trackedWallets.length === 0) {
      setHistoryByWallet({});
      return;
    }

    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const nextMatchId = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "nextMatchId",
        args: [],
      });
      const count = Number(nextMatchId);
      const ids = Array.from({ length: count }, (_, idx) => BigInt(idx));
      const snapshots: Array<{ id: bigint; data: MatchData; creatorVote: Address; opponentVote: Address }> = [];
      const chunkSize = 25;

      for (let start = 0; start < ids.length; start += chunkSize) {
        const chunk = ids.slice(start, start + chunkSize);
        const reads = await Promise.all(
          chunk.map(async (itemId) => {
            try {
              const [row, creatorVote, opponentVote] = await Promise.all([
                publicClient.readContract({
                  address: escrowAddress,
                  abi: escrowAbi,
                  functionName: "getMatch",
                  args: [itemId],
                }),
                publicClient.readContract({
                  address: escrowAddress,
                  abi: escrowAbi,
                  functionName: "creatorReportedWinner",
                  args: [itemId],
                }),
                publicClient.readContract({
                  address: escrowAddress,
                  abi: escrowAbi,
                  functionName: "opponentReportedWinner",
                  args: [itemId],
                }),
              ]);
              return {
                id: itemId,
                data: row as MatchData,
                creatorVote: creatorVote as Address,
                opponentVote: opponentVote as Address,
              };
            } catch {
              return null;
            }
          }),
        );
        for (const row of reads) {
          if (row) snapshots.push(row);
        }
      }

      const built: Record<string, WalletHistory> = {};
      for (const wallet of trackedWallets) {
        built[wallet] = { wins: 0, losses: 0, resolved: 0, disputes: 0, noResponseFlags: 0, entries: [] };
      }

      for (const row of snapshots) {
        const [rowCreator, rowOpponent, , , rowStatus, , , rowWinner] = row.data;
        const creatorLower = rowCreator.toLowerCase();
        const opponentLower = rowOpponent.toLowerCase();
        if (opponentLower === zeroAddress) continue;

        for (const tracked of trackedWallets) {
          const isCreatorWallet = tracked === creatorLower;
          const isOpponentWallet = tracked === opponentLower;
          if (!isCreatorWallet && !isOpponentWallet) continue;

          const walletHistory = built[tracked];
          const rival = (isCreatorWallet ? rowOpponent : rowCreator) as Address;
          const trackedVote = (isCreatorWallet ? row.creatorVote : row.opponentVote).toLowerCase();
          const rivalVote = (isCreatorWallet ? row.opponentVote : row.creatorVote).toLowerCase();
          const trackedVoted = trackedVote !== zeroAddress;
          const rivalVoted = rivalVote !== zeroAddress;

          let result: HistoryResult = "Pending";
          const statusNum = Number(rowStatus);
          if (statusNum === 5) {
            walletHistory.resolved += 1;
            if (rowWinner.toLowerCase() === tracked) {
              walletHistory.wins += 1;
              result = "Win";
            } else {
              walletHistory.losses += 1;
              result = "Loss";
            }
          } else if (statusNum === 4) {
            walletHistory.disputes += 1;
            result = "Disputed";
          }

          if ((statusNum === 4 || statusNum === 5) && !trackedVoted && rivalVoted) {
            walletHistory.noResponseFlags += 1;
          }

          walletHistory.entries.push({
            matchId: row.id.toString(),
            opponent: rival,
            result,
          });
        }
      }

      for (const wallet of Object.keys(built)) {
        built[wallet].entries.sort((a, b) => Number(b.matchId) - Number(a.matchId));
        built[wallet].entries = built[wallet].entries.slice(0, 6);
      }

      setHistoryByWallet(built);
    } catch (error: any) {
      setHistoryError(error?.shortMessage || error?.message || String(error));
    } finally {
      setHistoryLoading(false);
    }
  }

  function submitWinClaim() {
    if (!canAct || !address || !canDeclare || isOutcomeSubmitting) return;
    setIsOutcomeSubmitting(true);
    runTx(() =>
      writeWithNonce({
        address: escrowAddress!,
        abi: escrowAbi,
        functionName: "proposeWinner",
        args: [matchId, address] as const,
      }),
      () => setShowAwaitingOpponent(true),
    );
  }

  function submitLossClaim() {
    if (!canAct || !opponentAddressForLoss || !canDeclare || isOutcomeSubmitting) return;
    setIsOutcomeSubmitting(true);
    runTx(() =>
      writeWithNonce({
        address: escrowAddress!,
        abi: escrowAbi,
        functionName: "proposeWinner",
        args: [matchId, opponentAddressForLoss] as const,
      }),
    );
  }

  function submitDispute() {
    if (!canAct) return;
    runTx(
      () =>
        writeWithNonce({
          address: escrowAddress!,
          abi: escrowAbi,
          functionName: "dispute",
          args: [matchId],
        }),
      () => {
        setShowDisputeConfirm(false);
        setShowAwaitingOpponent(false);
      },
    );
  }

  const canAct = Boolean(isConnected && escrowAddress);
  const matchStarted = Boolean(
    (statusNum === 2 || statusNum === 3 || statusNum === 4) && cancelCountdown === 0,
  );
  const canShowDispute = Boolean(canAct && canDeclare && matchStarted);
  const canCancelCreated = Boolean(canAct && isCreator && statusNum === 0);
  const canCancelGrace = Boolean(
    canAct &&
      (isCreator || isOpponent) &&
      (statusNum === 1 || statusNum === 2) &&
      cancelCountdown !== null &&
      cancelCountdown > 0,
  );
  const canCancel = canCancelCreated || canCancelGrace;
  const showCreatorWaiting = Boolean(isCreator && statusNum === 0 && !opponentPaid);
  const showOpponentJoin = Boolean(!isCreator && canJoin && typeof stake === "bigint");
  const roomFull = Boolean(
    hasValidRoomCode &&
      matchExists &&
      !isPlayer &&
      (statusNum !== 0 || opponentPaid || (opponent && opponent.toLowerCase() !== zeroAddress)),
  );
  const walletBalanceText = walletBalanceQuery.data
    ? Number(walletBalanceQuery.data.formatted).toLocaleString(undefined, { maximumFractionDigits: 6 })
    : "-";

  useEffect(() => {
    if ((statusNum === 1 || statusNum === 2) && opponent) {
      setJoinedNotice(true);
      const timeoutId = setTimeout(() => setJoinedNotice(false), 4000);
      return () => clearTimeout(timeoutId);
    }
    return;
  }, [statusNum, opponent]);

  useEffect(() => {
    if (statusNum !== 3 || typeof confirmByRaw !== "bigint") return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [statusNum, confirmByRaw]);

  useEffect(() => {
    if ((statusNum !== 1 && statusNum !== 2 && statusNum !== 3) || !opponent || typeof joinedAt !== "bigint") {
      setCancelCountdown(null);
      return;
    }
    const joinedAtMs = Number(joinedAt) * 1000;
    const nowMs = Date.now();
    const initial = Math.max(0, 60 - Math.floor((nowMs - joinedAtMs) / 1000));
    setCancelCountdown(initial);
    const intervalId = setInterval(() => {
      setCancelCountdown((prev) => (prev && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(intervalId);
  }, [statusNum, opponent, joinedAt]);

  useEffect(() => {
    if (!isOutcomeSubmitting) return;
    if (err) {
      setIsOutcomeSubmitting(false);
    }
  }, [err, isOutcomeSubmitting]);

  useEffect(() => {
    if (!isOutcomeSubmitting) return;
    if (statusNum === 4 || statusNum === 5 || statusNum === 6) {
      setIsOutcomeSubmitting(false);
    }
  }, [statusNum, isOutcomeSubmitting]);

  async function joinAndLockStake() {
    if (!stakeValue || !escrowAddress) return;
    await runTx(() =>
      writeWithNonce({
        address: escrowAddress!,
        abi: escrowAbi,
        functionName: "joinMatch",
        args: [matchId],
        value: stakeValue,
      })
    );
  }

  function handleJoinClick() {
    if (!canJoin || typeof stake !== "bigint") return;
    if (!isConnected) {
      setJoinAfterConnect(true);
      openConnectRef.current?.();
      return;
    }
    joinAndLockStake();
  }

  useEffect(() => {
    if (!joinAfterConnect || !isConnected) return;
    if (!canJoin || typeof stake !== "bigint") {
      setJoinAfterConnect(false);
      return;
    }
    setJoinAfterConnect(false);
    joinAndLockStake();
  }, [joinAfterConnect, isConnected, canJoin, stake]);

  useEffect(() => {
    if (!autoJoinRequested) return;
    if (!autoJoinEligible || autoJoinTriggered) return;
    if (!isConnected) return;
    setAutoJoinTriggered(true);
    joinAndLockStake();
  }, [autoJoinRequested, autoJoinEligible, isConnected, autoJoinTriggered]);

  useEffect(() => {
    if (!creator || creator.toLowerCase() === zeroAddress) return;
    if (!opponent || opponent.toLowerCase() === zeroAddress) return;
    loadWalletHistories();
  }, [creator, opponent, escrowAddress]);

  useEffect(() => {
    if (!showAwaitingOpponent) return;
    if (!address || statusNum !== 3 || !proposedWinner) {
      setShowAwaitingOpponent(false);
      return;
    }
    if (proposedWinner.toLowerCase() !== address.toLowerCase()) {
      setShowAwaitingOpponent(false);
    }
  }, [showAwaitingOpponent, address, statusNum, proposedWinner]);

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

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sky-500 mb-1">
              <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
              Match Protocol
            </div>
            <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white sm:text-4xl">
              Match Room{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-sky-200">
                #{hasValidRoomCode ? roomCode : id}
              </span>
            </h1>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link
              className="group relative flex items-center justify-center overflow-hidden border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-white/10 sm:text-sm"
              href="/"
            >
              <span className="relative z-10">Back</span>
            </Link>
            <Link
              className="group relative flex items-center justify-center overflow-hidden border border-sky-500/30 bg-sky-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-sky-400 transition-all hover:bg-sky-500/20 sm:text-sm"
              href="/matches"
            >
              <span className="relative z-10">Matches</span>
            </Link>
            <button
              className="group relative flex items-center justify-center overflow-hidden border border-sky-500/30 bg-sky-500/10 px-6 py-2 text-xs font-bold uppercase tracking-wider text-sky-400 transition-all hover:bg-sky-500/20 sm:text-sm"
              onClick={() => {
                matchQuery.refetch();
                matchStorageQuery.refetch();
                loadWalletHistories();
              }}
            >
              <span className="relative z-10">Refresh</span>
            </button>
          </div>
        </div>

        {!escrowAddress && (
          <div className="mb-6 border border-red-500/20 bg-red-500/10 p-4 text-red-400 font-mono text-sm">
            Missing NEXT_PUBLIC_MATCH_ESCROW_ADDRESS in apps/web/.env.local
          </div>
        )}

        <ConnectButton.Custom>
          {({ openConnectModal }) => {
            openConnectRef.current = openConnectModal;
            return null;
          }}
        </ConnectButton.Custom>

        <div className="grid gap-8 lg:grid-cols-12">
          {/* Left Column: Stats */}
          <div className="lg:col-span-7 space-y-6">
            {/* Status Banner */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(59,130,246,0.12),transparent_45%)]" />
              <div className="relative rounded-[22px] bg-slate-900/90 p-6 backdrop-blur-xl">
                <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Current Status</div>
                <div className="mt-2 text-3xl font-black uppercase tracking-tight text-white">{statusText}</div>
                {isConnected && (
                  <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
                    Wallet balance:{" "}
                    {walletBalanceQuery.isLoading ? "Loading..." : `${walletBalanceText} ${nativeSymbol}`}
                  </div>
                )}
                {joinedNotice && (
                  <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs uppercase tracking-widest text-sky-300">
                    Opponent joined. Escrow is now locking stakes.
                  </div>
                )}
                {statusNum === 3 && timeoutSecondsLeft !== null && timeoutSecondsLeft > 0 && (
                  <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs uppercase tracking-widest text-amber-200">
                    Keeper timeout in {timeoutSecondsLeft}s
                  </div>
                )}
                {statusNum === 3 && timeoutSecondsLeft === 0 && (
                  <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs uppercase tracking-widest text-sky-200">
                    Timeout reached. Keeper will auto-finalize shortly.
                  </div>
                )}
                {statusNum === 5 && (
                  <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs uppercase tracking-widest text-emerald-200">
                    Match resolved on-chain.
                  </div>
                )}
                {creatorPaid && statusNum === 0 && (
                  <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs uppercase tracking-widest text-sky-300">
                    Creator stake locked. Opponent can join now.
                  </div>
                )}
                {opponentPaid && totalStakeText && (
                  <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-300/80">Possible Win</div>
                    <div className="mt-1 text-3xl font-black tracking-tight text-emerald-200 sm:text-4xl">
                      {totalStakeText} {nativeSymbol}
                    </div>
                    {winnerPayoutText && (
                      <div className="mt-1 text-xs text-emerald-200/80">
                        Estimated payout after 2% fee: {winnerPayoutText} {nativeSymbol}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Details Grid */}
            <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-5 backdrop-blur-xl sm:p-6">
              <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
                <div className="h-1 w-4 bg-sky-500" />
                Match Data
              </h3>
              <div className="space-y-4 font-mono text-sm">
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Room Code</span>
                  <span className="flex items-center gap-2">
                    <span className="text-white">{hasValidRoomCode ? roomCode : "-"}</span>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-200 hover:bg-white/10"
                      onClick={copyRoomCodeValue}
                      disabled={!hasValidRoomCode}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      <span className="ml-1">{copiedRoomCode ? "Copied" : "Copy"}</span>
                    </button>
                  </span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Match Link</span>
                  <span className="flex items-center gap-2 sm:max-w-[60%]">
                    <span className="truncate text-white sm:text-right">{inviteLinkPreview}</span>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-200 hover:bg-white/10"
                      onClick={copyMatchLinkValue}
                      disabled={!invitePath}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                      <span className="ml-1">{copiedMatchLink ? "Copied" : "Copy"}</span>
                    </button>
                  </span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Chain Match ID</span>
                  <span className="text-white">{hasValidRoomCode ? matchId.toString() : "-"}</span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Creator</span>
                  <span className="text-sky-400 break-all sm:text-right">{creator ?? "-"}</span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Opponent</span>
                  <span className="text-sky-400 break-all sm:text-right">{opponent ?? "-"}</span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Stake</span>
                  <span className="text-white">{stakeEth} {nativeSymbol}</span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Creator Paid</span>
                  <span className={creatorPaid ? "text-sky-500" : "text-red-500"}>
                    {String(Boolean(creatorPaid))}
                  </span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Opponent Paid</span>
                  <span className={opponentPaid ? "text-sky-500" : "text-red-500"}>
                    {String(Boolean(opponentPaid))}
                  </span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Proposed Winner</span>
                  <span className="text-white break-all sm:text-right">{proposedWinner ?? "-"}</span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Joined At</span>
                  <span className="text-white">
                    {typeof joinedAt === "bigint" && joinedAt > 0n
                      ? new Date(Number(joinedAt) * 1000).toLocaleTimeString()
                      : "-"}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-5 backdrop-blur-xl sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
                  <div className="h-1 w-4 bg-emerald-500" />
                  Player History
                </h3>
                <button
                  type="button"
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-300 hover:bg-white/10"
                  onClick={loadWalletHistories}
                >
                  Refresh
                </button>
              </div>

              {historyLoading && (
                <div className="rounded-2xl border border-white/10 bg-black/50 p-3 text-xs text-gray-400">
                  Loading on-chain history...
                </div>
              )}
              {historyError && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300 break-all">
                  {historyError}
                </div>
              )}

              {!historyLoading && !historyError && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[creator, opponent]
                    .filter((wallet): wallet is Address => Boolean(wallet && wallet.toLowerCase() !== zeroAddress))
                    .map((wallet) => {
                      const key = wallet.toLowerCase();
                      const history = historyByWallet[key] ?? {
                        wins: 0,
                        losses: 0,
                        resolved: 0,
                        disputes: 0,
                        noResponseFlags: 0,
                        entries: [],
                      };
                      const winRate =
                        history.resolved > 0
                          ? Math.round((history.wins / history.resolved) * 100)
                          : 0;
                      return (
                        <div key={wallet} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                          <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">
                            {wallet.toLowerCase() === creator?.toLowerCase()
                              ? "Creator"
                              : wallet.toLowerCase() === opponent?.toLowerCase()
                              ? "Opponent"
                              : "Player"}
                          </div>
                          <div className="mt-1 font-mono text-sm text-sky-300">{shortAddress(wallet)}</div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-center text-emerald-200">
                              <div className="text-[10px] uppercase tracking-widest text-emerald-300/80">Wins</div>
                              <div className="mt-1 text-base font-bold">{history.wins}</div>
                            </div>
                            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-2 py-2 text-center text-red-200">
                              <div className="text-[10px] uppercase tracking-widest text-red-300/80">Losses</div>
                              <div className="mt-1 text-base font-bold">{history.losses}</div>
                            </div>
                            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-2 py-2 text-center text-sky-200">
                              <div className="text-[10px] uppercase tracking-widest text-sky-300/80">Win%</div>
                              <div className="mt-1 text-base font-bold">{winRate}%</div>
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-center text-amber-200">
                              <div className="text-[10px] uppercase tracking-widest text-amber-300/80">Disputes</div>
                              <div className="mt-1 text-base font-bold">{history.disputes}</div>
                            </div>
                            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-center text-rose-200">
                              <div className="text-[10px] uppercase tracking-widest text-rose-300/80">No-Response</div>
                              <div className="mt-1 text-base font-bold">{history.noResponseFlags}</div>
                            </div>
                          </div>
                          <div className="mt-2 text-[11px] text-gray-500">
                            No-response flags indicate matches where opponent acted but this player never submitted any outcome.
                          </div>
                          <div className="mt-3 space-y-1">
                            {history.entries.length === 0 && (
                              <div className="text-[11px] text-gray-500">No previous matches found.</div>
                            )}
                            {history.entries.map((entry) => (
                              <div
                                key={`${wallet}-${entry.matchId}-${entry.opponent}`}
                                className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 px-2 py-1.5 text-[11px]"
                              >
                                <span className="text-gray-400">#{entry.matchId} vs {shortAddress(entry.opponent)}</span>
                                <span
                                  className={
                                    entry.result === "Win"
                                      ? "text-emerald-300"
                                      : entry.result === "Loss"
                                      ? "text-red-300"
                                      : entry.result === "Disputed"
                                      ? "text-amber-300"
                                      : "text-gray-400"
                                  }
                                >
                                  {entry.result}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Actions */}
          <div className="lg:col-span-5 space-y-6">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(59,130,246,0.12),transparent_45%)]" />
              <div className="relative rounded-[22px] bg-slate-900/90 p-6 backdrop-blur-xl">
                <h3 className="mb-6 text-xl font-bold uppercase tracking-widest text-white flex items-center gap-3">
                  <div className="h-2 w-2 bg-red-500 rotate-45" />
                  Command Center
                </h3>

                <div className="space-y-3">
                  {!matchLoaded && (
                    <div className="rounded-2xl border border-white/10 bg-black/50 p-4 text-xs text-gray-400">
                      Loading match data... If this persists, click Refresh.
                    </div>
                  )}
                  {!hasValidRoomCode && (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300">
                      Invalid room code. Enter a numeric room code (for example: 100245).
                    </div>
                  )}
                  {matchLoaded && !matchExists && (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300">
                      Match not found. Confirm you are on the same network and using a valid room code.
                    </div>
                  )}
                  {roomFull && (
                    <div className="w-full rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center text-xs font-bold uppercase tracking-wider text-red-300">
                      Room Full
                    </div>
                  )}
                  {showCreatorWaiting && (
                    <div className="w-full rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-center text-xs font-bold uppercase tracking-wider text-sky-200">
                      Waiting for Opponent to Join
                    </div>
                  )}
                  {showOpponentJoin && (
                    <button
                      className="w-full rounded-2xl border border-sky-500/40 bg-sky-500/20 p-4 font-bold uppercase tracking-wider text-sky-100 transition-all hover:bg-sky-500/30 disabled:opacity-20 disabled:cursor-not-allowed disabled:bg-gray-800"
                      onClick={handleJoinClick}
                    >
                      {!isConnected
                        ? `Connect Wallet + Lock ${nativeSymbol} Stake`
                        : `Join + Lock ${nativeSymbol} Stake`}
                    </button>
                  )}

                  {awaitingAcceptOrDispute && normalizedProposedWinner && (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                      <div className="text-[10px] uppercase tracking-[0.3em] text-amber-300/80">
                        Opponent Reported Result
                      </div>
                      <p className="mt-2 text-xs text-amber-100/90">
                        Opponent claimed they won. Accept to release funds now, cancel to open dispute, or wait for timeout auto-finalization by keeper.
                      </p>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                          className="rounded-2xl border border-emerald-500/40 bg-emerald-500/20 p-3 text-xs font-bold uppercase tracking-wider text-emerald-100 transition-all hover:bg-emerald-500/30 disabled:opacity-20"
                          disabled={!canAct}
                          onClick={() =>
                            runTx(() =>
                              writeWithNonce({
                                address: escrowAddress!,
                                abi: escrowAbi,
                                functionName: "proposeWinner",
                                args: [matchId, normalizedProposedWinner] as const,
                              }),
                            )
                          }
                        >
                          Accept Result
                        </button>
                        <button
                          className="rounded-2xl border border-red-500/40 bg-red-500/20 p-3 text-xs font-bold uppercase tracking-wider text-red-100 transition-all hover:bg-red-500/30 disabled:opacity-20"
                          disabled={!canAct}
                          onClick={() => setShowDisputeConfirm(true)}
                        >
                          Cancel To Dispute
                        </button>
                      </div>
                    </div>
                  )}

                <div className={`grid grid-cols-1 gap-3 ${canShowDispute ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
                  {canShowDispute && (
                    <button
                      className="rounded-2xl border border-red-500/30 bg-slate-700/20 p-3 font-bold uppercase tracking-wider text-red-500 transition-all hover:bg-red-900/20 disabled:opacity-20"
                      disabled={!canAct}
                      onClick={() => setShowDisputeConfirm(true)}
                    >
                      Dispute
                    </button>
                  )}
                  <button
                    className="rounded-2xl border border-red-500/30 bg-slate-700/20 p-3 font-bold uppercase tracking-wider text-red-500 transition-all hover:bg-red-900/20 disabled:opacity-20"
                      disabled={!canCancel}
                      onClick={() => runTx(() => writeWithNonce({ address: escrowAddress!, abi: escrowAbi, functionName: "cancel", args: [matchId] }))}
                    >
                      {statusNum === 0 && isCreator
                        ? `Cancel + Refund ${nativeSymbol}`
                        : cancelCountdown !== null && cancelCountdown > 0
                        ? `Cancel (${cancelCountdown}s)`
                        : "Cancel"}
                    </button>
                  </div>
                  {statusNum === 0 && isCreator ? (
                    <p className="text-[11px] text-gray-500">
                      You can cancel now and your locked {nativeSymbol} stake is refunded to your wallet.
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-500">
                      Both players can cancel for 60s after an opponent joins. After that, escrow is locked.
                    </p>
                  )}
                  {(statusNum === 2 || statusNum === 3) && cancelCountdown !== null && cancelCountdown > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-black/50 p-3 text-xs text-gray-400">
                      Outcome controls unlock after the 60-second grace period. Time left: {cancelCountdown}s.
                    </div>
                  )}
                </div>

                {canSelectOutcome && !awaitingAcceptOrDispute && !hasSubmittedOutcome && (
                  <div className="mt-6 border-t border-white/10 pt-4">
                    <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Declare Outcome</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={submitWinClaim}
                        disabled={!canAct || !canDeclare || !address || isOutcomeSubmitting}
                        className="rounded-2xl border border-sky-500/60 bg-sky-500/20 p-3 text-sm font-bold uppercase tracking-wider text-sky-100 transition hover:bg-sky-500/30 disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        {isOutcomeSubmitting ? "Submitting..." : "I won"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowLoseConfirm(true)}
                        disabled={!canAct || !canDeclare || !opponentAddressForLoss || isOutcomeSubmitting}
                        className="rounded-2xl border border-red-500/40 bg-red-500/15 p-3 text-sm font-bold uppercase tracking-wider text-red-100 transition hover:bg-red-500/25 disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        {isOutcomeSubmitting ? "Submitting..." : "I lost"}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      If you choose "I lost", payout is released immediately to opponent after wallet confirmation.
                    </p>
                    {statusNum === 3 && proposedWinner && address && proposedWinner.toLowerCase() === address.toLowerCase() && (
                      <div className="mt-2 text-xs text-gray-400">
                        Waiting for opponent declaration. If they do nothing until timeout, keeper will auto-finalize this result.
                      </div>
                    )}
                    {statusNum === 3 && timeoutSecondsLeft !== null && (
                      <div className="mt-2 text-xs text-gray-400">
                        Keeper auto-finalization window: {timeoutSecondsLeft > 0 ? `${timeoutSecondsLeft}s left` : "ready now"}.
                      </div>
                    )}
                    {statusNum === 3 && !proposedWinner && (
                      <div className="mt-2 text-xs text-gray-400">
                        Conflicting outcomes detected. Open a dispute to resolve.
                      </div>
                    )}
                  </div>
                )}

                {canSelectOutcome && hasSubmittedOutcome && statusNum === 3 && (
                  <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-100">
                    Outcome already submitted. Waiting for opponent response or keeper timeout. You can still open dispute.
                  </div>
                )}

                {showPostMatchActions && (
                  <div className="mt-6 border-t border-white/10 pt-4">
                    <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Next Match</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Link
                        href={rematchHref}
                        className="rounded-2xl border border-emerald-500/40 bg-emerald-500/20 p-3 text-center text-xs font-bold uppercase tracking-wider text-emerald-100 transition hover:bg-emerald-500/30"
                      >
                        Rematch Same Stake
                      </Link>
                      <Link
                        href="/matches/create"
                        className="rounded-2xl border border-white/20 bg-white/5 p-3 text-center text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/10"
                      >
                        Exit + New Amount
                      </Link>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      Rematch pre-fills the same stake for both players and reopens escrow for a new game.
                    </p>
                  </div>
                )}

                {txHash && (
                  <div className="mt-4 border-t border-white/5 pt-4">
                    <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Transaction Hash</p>
                    <p className="truncate text-xs font-mono text-sky-500">{txHash}</p>
                  </div>
                )}
                {err && <div className="mt-2 text-xs text-red-500 break-all bg-red-900/20 p-2 border border-red-500/20">{err}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAwaitingOpponent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowAwaitingOpponent(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-sky-500/30 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-[11px] uppercase tracking-[0.35em] text-sky-300/80">Result Submitted</div>
            <h3 className="mt-2 text-3xl font-semibold text-white">Waiting For Opponent</h3>
            <p className="mt-3 text-sm text-gray-300">
              Your win was submitted on-chain. Opponent can accept now, dispute, or timeout will allow keeper auto-finalization.
            </p>
            {timeoutSecondsLeft !== null && (
              <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Keeper timeout: {timeoutSecondsLeft > 0 ? `${timeoutSecondsLeft}s remaining` : "ready now"}
              </div>
            )}
            <button
              type="button"
              className="mt-6 w-full rounded-2xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-500/30"
              onClick={() => setShowAwaitingOpponent(false)}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {showDisputeConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowDisputeConfirm(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-red-500/30 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-[11px] uppercase tracking-[0.35em] text-red-300/80">Confirm Dispute</div>
            <h3 className="mt-2 text-2xl font-semibold text-white">Open dispute now?</h3>
            <p className="mt-3 text-sm text-gray-300">
              This sends the match to dispute state for admin resolution.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
                onClick={() => setShowDisputeConfirm(false)}
              >
                Go Back
              </button>
              <button
                type="button"
                className="rounded-2xl border border-red-500/40 bg-red-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-red-100 hover:bg-red-500/30 disabled:opacity-20"
                disabled={!canAct}
                onClick={submitDispute}
              >
                Confirm Dispute
              </button>
            </div>
          </div>
        </div>
      )}

      {showLoseConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowLoseConfirm(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-[11px] uppercase tracking-[0.35em] text-red-300/80">Confirm Loss</div>
            <h3 className="mt-2 text-2xl font-semibold text-white">Are you sure you lost?</h3>
            <p className="mt-3 text-sm text-gray-400">
              Confirming loss releases payout to your opponent immediately after wallet approval.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
                onClick={() => setShowLoseConfirm(false)}
              >
                Go Back
              </button>
              <button
                type="button"
                className="rounded-2xl border border-red-500/40 bg-red-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-red-100 hover:bg-red-500/30 disabled:opacity-20"
                disabled={!canAct || !canDeclare || !opponentAddressForLoss || isOutcomeSubmitting}
                onClick={() => {
                  setShowLoseConfirm(false);
                  submitLossClaim();
                }}
              >
                {isOutcomeSubmitting ? "Submitting..." : "Confirm I Lost"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}





