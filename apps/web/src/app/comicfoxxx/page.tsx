"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useDisconnect, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { formatEther, type Address } from "viem";
import { loadDisputeEvidence, type DisputeEvidenceItem } from "@/lib/disputeEvidence";
import {
  appendDisputeMessage,
  ensureDisputeAutoMessage,
  loadDisputeMessages,
  type DisputeMessageItem,
} from "@/lib/disputeMessages";
import { loadWalletProfiles } from "@/lib/profile";
import { decodeMatchCode } from "@/lib/matchCode";
import {
  getEscrowAddressForChain,
  getNativeSymbolForChain,
  getSupportedChainNames,
  isSupportedChainId,
} from "@/lib/chains";
import PageShell from "@/components/PageShell";
import GlassCard from "@/components/GlassCard";

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
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
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

const ADMIN_MAX_SCAN_MATCHES = Math.max(
  100,
  Math.min(2000, Number(process.env.NEXT_PUBLIC_ADMIN_MAX_SCAN_MATCHES || "600")),
);

function formatCountdown(totalSeconds: number | null) {
  if (totalSeconds === null) return "-";
  const safe = Math.max(0, totalSeconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

type MatchData = readonly [Address, Address, bigint, bigint, bigint | number, boolean, boolean, Address];
type AdminResolveIntent = {
  winner: Address;
  refundBoth: boolean;
  label: string;
};

type QueueFilter = "all" | "pending" | "completed";

function normalizeDisputeMessages(items: DisputeMessageItem[]) {
  const byId = new Map<string, DisputeMessageItem>();
  for (const item of items) {
    if (!item?.id) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export default function AdminDisputesPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  type BaseWriteConfig = Parameters<typeof writeContractAsync>[0];
  type WriteConfig = Omit<BaseWriteConfig, "value" | "nonce"> & {
    value?: bigint;
    nonce?: number;
  };
  const escrowAddress = getEscrowAddressForChain(chainId);
  const nativeSymbol = getNativeSymbolForChain(chainId);
  const chainSupported = isSupportedChainId(chainId);
  const adminPassword = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "2162";

  const [matchIdInput, setMatchIdInput] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adminPassInput, setAdminPassInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const [disputedIds, setDisputedIds] = useState<string[]>([]);
  const [completedDisputeIds, setCompletedDisputeIds] = useState<string[]>([]);
  const [isLoadingDisputes, setIsLoadingDisputes] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<DisputeEvidenceItem[]>([]);
  const [disputeMessages, setDisputeMessages] = useState<DisputeMessageItem[]>([]);
  const [adminMessageDraft, setAdminMessageDraft] = useState("");
  const [adminMessageError, setAdminMessageError] = useState<string | null>(null);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [resolveIntent, setResolveIntent] = useState<AdminResolveIntent | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [walletUsernames, setWalletUsernames] = useState<Record<string, string>>({});
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(null);
  const disputeMessagesRequestSeqRef = useRef(0);
  const normalizedMatchIdInput = matchIdInput.trim();

  const decodedMatchId = useMemo(
    () => decodeMatchCode(normalizedMatchIdInput),
    [normalizedMatchIdInput],
  );
  const matchId = decodedMatchId ?? 0n;
  const matchKey = decodedMatchId ? decodedMatchId.toString() : "";

  const matchQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getMatch",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress) && decodedMatchId !== null },
  });
  const adminAddressQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "admin",
    args: [],
    query: { enabled: Boolean(escrowAddress), refetchInterval: 10000 },
  });

  const data = matchQuery.data as MatchData | undefined;
  const contractAdmin = adminAddressQuery.data as Address | undefined;
  const creator = data?.[0];
  const opponent = data?.[1];
  const stake = data?.[2];
  const joinedAt = data?.[3];
  const status = data?.[4];
  const proposedWinner = data?.[7];

  const statusNum =
    typeof status === "bigint" ? Number(status) : typeof status === "number" ? status : undefined;
  const statusText = typeof statusNum === "number" ? (STATUS[statusNum] ?? `Unknown(${statusNum})`) : "-";
  const stakeEth = typeof stake === "bigint" ? formatEther(stake) : "-";
  const isFundedMatch = statusNum === 2;
  const isResultProposedMatch = statusNum === 3;
  const isDisputedMatch = statusNum === 4;
  const canResolveInAdmin = isFundedMatch || isResultProposedMatch || isDisputedMatch;
  const isContractAdmin = Boolean(
    isConnected &&
      address &&
      contractAdmin &&
      address.toLowerCase() === contractAdmin.toLowerCase(),
  );
  const shortAddress = (value?: string) =>
    value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "-";
  const usernameForWallet = (value?: string) => {
    if (!value) return null;
    return walletUsernames[value.toLowerCase()] ?? null;
  };
  const displayNameForWallet = (value?: string) => usernameForWallet(value) ?? shortAddress(value);
  const formatFileSize = (sizeBytes: number) => {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 B";
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
    return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
  };
  const disputeIntroMessage = useMemo(
    () => disputeMessages.find((message) => message.senderRole === "system") ?? null,
    [disputeMessages],
  );
  const disputeStartedAtMs = disputeIntroMessage?.createdAt ?? null;
  const disputeElapsedMs = disputeStartedAtMs ? Math.max(0, nowMs - disputeStartedAtMs) : 0;
  const evidenceWindowRemainingSec = disputeStartedAtMs
    ? Math.max(0, Math.floor((10 * 60 * 1000 - disputeElapsedMs) / 1000))
    : null;
  const policyWindowRemainingSec = disputeStartedAtMs
    ? Math.max(0, Math.floor((30 * 60 * 1000 - disputeElapsedMs) / 1000))
    : null;
  const creatorEvidenceCount = evidenceItems.filter(
    (item) => creator && item.uploader.toLowerCase() === creator.toLowerCase(),
  ).length;
  const opponentEvidenceCount = evidenceItems.filter(
    (item) => opponent && item.uploader.toLowerCase() === opponent.toLowerCase(),
  ).length;
  const policyWinnerAddress = useMemo(() => {
    if (!creator || !opponent) return undefined;
    if (policyWindowRemainingSec !== 0) return undefined;
    if (creatorEvidenceCount > 0 && opponentEvidenceCount === 0) return creator;
    if (opponentEvidenceCount > 0 && creatorEvidenceCount === 0) return opponent;
    return undefined;
  }, [creator, opponent, policyWindowRemainingSec, creatorEvidenceCount, opponentEvidenceCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const parseIds = (raw: string | null) => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as string[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    setDisputedIds(parseIds(window.localStorage.getItem("admin_disputes_cache")));
    setCompletedDisputeIds(parseIds(window.localStorage.getItem("admin_disputes_completed_cache")));
  }, []);

  useEffect(() => {
    if (!matchKey) {
      setEvidenceItems([]);
      setDisputeMessages([]);
      return;
    }
    let cancelled = false;
    const loadAll = async () => {
      const [evidence, messages] = await Promise.all([
        loadDisputeEvidence(matchKey),
        loadDisputeMessages(matchKey),
      ]);
      if (cancelled) return;
      setEvidenceItems(evidence);
      setDisputeMessages((previous) => {
        if (messages.length === 0 && previous.length > 0) return previous;
        return normalizeDisputeMessages([...previous, ...messages]);
      });
    };
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [matchKey, txHash]);

  useEffect(() => {
    const wallets = Array.from(
      new Set(
        [
          creator,
          opponent,
          address,
          contractAdmin,
          ...disputeMessages
            .filter((item) => item.senderRole === "player")
            .map((item) => item.senderAddress),
          ...evidenceItems.map((item) => item.uploader),
        ]
          .filter((wallet): wallet is string => Boolean(wallet))
          .map((wallet) => wallet.toLowerCase())
          .filter((wallet) => /^0x[a-f0-9]{40}$/.test(wallet)),
      ),
    );
    if (wallets.length === 0) return;

    let cancelled = false;
    async function run() {
      const profiles = await loadWalletProfiles(wallets);
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [wallet, profile] of Object.entries(profiles)) {
        const username = profile?.username?.trim();
        if (username) next[wallet] = username;
      }
      setWalletUsernames((previous) => ({ ...previous, ...next }));
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [address, contractAdmin, creator, opponent, disputeMessages, evidenceItems]);

  useEffect(() => {
    if (statusNum !== 4 || !matchKey) return;
    void ensureDisputeAutoMessage(matchKey);
    void refreshDisputeMessages();
    void refreshEvidenceItems();
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [statusNum, matchKey]);

  useEffect(() => {
    if (!authed) return;
    if (!publicClient || !escrowAddress) return;

    loadDisputes();
    const intervalId = window.setInterval(() => {
      loadDisputes();
    }, 20000);
    return () => window.clearInterval(intervalId);
  }, [authed, publicClient, escrowAddress]);

  useEffect(() => {
    if (!authed) return;
    if (matchIdInput.trim()) return;
    if (disputedIds.length > 0) {
      setMatchIdInput(disputedIds[0]);
      return;
    }
    if (completedDisputeIds.length > 0) {
      setMatchIdInput(completedDisputeIds[0]);
    }
  }, [authed, disputedIds, completedDisputeIds, matchIdInput]);

  useEffect(() => {
    if (!matchKey) return;
    const key = `dispute-messages:${matchKey}`;
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) void refreshDisputeMessages();
    };
    window.addEventListener("storage", onStorage);
    const intervalId = window.setInterval(() => {
      void refreshDisputeMessages();
      void refreshEvidenceItems();
    }, 5000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(intervalId);
    };
  }, [matchKey]);

  useEffect(() => {
    if (data && canResolveInAdmin) {
      setShowDisputeModal(true);
      return;
    }
    setShowDisputeModal(false);
  }, [data, canResolveInAdmin]);

  async function writeWithNonce(config: WriteConfig) {
    if (!publicClient || !address) {
      return writeContractAsync(config as Parameters<typeof writeContractAsync>[0]);
    }
    const nonce = Number(await publicClient.getTransactionCount({ address, blockTag: "latest" }));
    return writeContractAsync({ ...config, nonce } as Parameters<typeof writeContractAsync>[0]);
  }

  async function resolveMatch(winner: Address, refundBoth: boolean) {
    if (!escrowAddress || !publicClient || !data) return;
    if (!isContractAdmin) {
      setErr("Connect the escrow admin wallet before resolving disputes.");
      return;
    }
    if (isResolving) return;
    setErr(null);
    setTxHash(null);
    setIsResolving(true);
    try {
      const [latestNonce, pendingNonce] = address
        ? await Promise.all([
            publicClient.getTransactionCount({ address, blockTag: "latest" }),
            publicClient.getTransactionCount({ address, blockTag: "pending" }),
          ])
        : [0n, 0n];
      if (pendingNonce > latestNonce) {
        throw new Error("Admin wallet has a pending transaction. Speed up or cancel it in wallet first.");
      }

      const latestRow = (await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "getMatch",
        args: [matchId] as const,
      })) as MatchData;
      const latestStatus = Number(latestRow[4]);
      if (latestStatus !== 2 && latestStatus !== 3 && latestStatus !== 4) {
        throw new Error("Match status changed and is no longer eligible for admin resolution.");
      }

      const hash = await writeWithNonce({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "adminResolve",
        args: [matchId, winner, refundBoth] as const,
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000, pollingInterval: 2_000 });

      if (matchKey) {
        const winnerLabel =
          winner && creator && winner.toLowerCase() === creator.toLowerCase()
            ? (usernameForWallet(creator) ?? "creator")
            : winner && opponent && winner.toLowerCase() === opponent.toLowerCase()
              ? (usernameForWallet(opponent) ?? "opponent")
              : displayNameForWallet(winner);
        const resolutionText = refundBoth
          ? "Dispute resolved by admin: both players were refunded. Match is closed."
          : `Dispute resolved by admin: payout released to ${winnerLabel}. Match is closed.`;
        await appendDisputeMessage(matchKey, {
          senderRole: "system",
          senderAddress: "system",
          message: resolutionText,
        });
      }

      await Promise.all([matchQuery.refetch(), loadDisputes()]);
      if (matchKey) {
        setDisputedIds((prev) => prev.filter((id) => id !== matchKey));
        setCompletedDisputeIds((prev) => {
          const next = Array.from(new Set([matchKey, ...prev])).sort((a, b) => Number(b) - Number(a));
          if (typeof window !== "undefined") {
            window.localStorage.setItem("admin_disputes_completed_cache", JSON.stringify(next));
          }
          return next;
        });
      }
      setShowDisputeModal(false);
      await refreshDisputeMessages();
      setResolveIntent(null);
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
    } finally {
      setIsResolving(false);
    }
  }

  function requestResolveAction(winner: Address, refundBoth: boolean, label: string) {
    if (!isContractAdmin) {
      setErr("Connect the escrow admin wallet before resolving disputes.");
      return;
    }
    setResolveIntent({ winner, refundBoth, label });
  }

  async function loadDisputes() {
    if (!publicClient || !escrowAddress) return;
    if (isLoadingDisputes) return;
    setIsLoadingDisputes(true);
    setDisputeError(null);
    try {
      let knownDisputeSet = new Set<string>();
      try {
        const response = await fetch("/api/disputes/index", { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { ids?: string[] };
          knownDisputeSet = new Set((payload.ids ?? []).map((id) => String(id)));
        }
      } catch {
        // fall back to local cache + on-chain scan
      }
      const cachedCompletedSet = new Set(completedDisputeIds.map((id) => String(id)));

      const nextMatchId = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "nextMatchId",
        args: [],
      });

      const count = Number(nextMatchId);
      const start = Math.max(0, count - ADMIN_MAX_SCAN_MATCHES);
      const ids = Array.from({ length: count - start }, (_, i) => BigInt(start + i));
      const pending: string[] = [];
      const completed: string[] = [];
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
          const idText = item.id.toString();
          const status = Number(item.row[4]);
          if (status === 4) {
            pending.push(idText);
            continue;
          }
          if (status === 5 && (knownDisputeSet.has(idText) || cachedCompletedSet.has(idText))) {
            completed.push(idText);
          }
        }
      }

      const uniquePendingIds = Array.from(new Set(pending)).sort((a, b) => Number(b) - Number(a));
      const uniqueCompletedIds = Array.from(new Set(completed)).sort((a, b) => Number(b) - Number(a));
      setDisputedIds(uniquePendingIds);
      setCompletedDisputeIds(uniqueCompletedIds);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("admin_disputes_cache", JSON.stringify(uniquePendingIds));
        window.localStorage.setItem("admin_disputes_completed_cache", JSON.stringify(uniqueCompletedIds));
      }
    } catch (e: any) {
      setDisputeError(e?.message || String(e));
    } finally {
      setIsLoadingDisputes(false);
    }
  }

  async function refreshDisputeMessages() {
    if (!matchKey) {
      setDisputeMessages([]);
      return;
    }
    const requestSeq = ++disputeMessagesRequestSeqRef.current;
    const incoming = await loadDisputeMessages(matchKey);
    if (requestSeq !== disputeMessagesRequestSeqRef.current) return;
    setDisputeMessages((previous) => {
      if (incoming.length === 0 && previous.length > 0) return previous;
      return normalizeDisputeMessages([...previous, ...incoming]);
    });
  }

  async function refreshEvidenceItems() {
    if (!matchKey) {
      setEvidenceItems([]);
      return;
    }
    setEvidenceItems(await loadDisputeEvidence(matchKey));
  }

  async function sendAdminMessage(messageOverride?: string) {
    setAdminMessageError(null);
    if (!matchKey) {
      setAdminMessageError("Load a disputed match first.");
      return;
    }
    if (!isContractAdmin) {
      setAdminMessageError("Connect escrow admin wallet to send admin messages.");
      return;
    }
    if (!isDisputedMatch) {
      setAdminMessageError("Messages can only be posted while dispute is active.");
      return;
    }
    const message = (messageOverride ?? adminMessageDraft).trim();
    if (!message) {
      setAdminMessageError("Message cannot be empty.");
      return;
    }
    try {
      await appendDisputeMessage(matchKey, {
        senderRole: "admin",
        senderAddress: address ?? "admin-panel",
        message,
      });
      setAdminMessageDraft("");
      await refreshDisputeMessages();
    } catch (error: any) {
      setAdminMessageError(error?.message || "Failed to send message.");
    }
  }

  function handleAdminUnlock() {
    if (adminPassInput === adminPassword) {
      setAuthed(true);
      setPassError(null);
    } else {
      setPassError("Incorrect password.");
    }
  }

  function selectMatchFromQueue(id: string, openDisputeRoom: boolean) {
    setErr(null);
    setMatchIdInput(id);
    setTimeout(() => {
      void matchQuery.refetch();
      if (openDisputeRoom) {
        setShowDisputeModal(true);
      }
    }, 0);
  }

  /* ---- helper: determine message alignment for the modal chat ---- */
  function getMessageStyle(message: DisputeMessageItem) {
    const isCreator = message.senderRole === "player" && creator && message.senderAddress.toLowerCase() === creator.toLowerCase();
    const isOpponent = message.senderRole === "player" && opponent && message.senderAddress.toLowerCase() === opponent.toLowerCase();
    const isAdmin = message.senderRole === "admin";
    const isSystem = message.senderRole === "system";

    if (isCreator) return { align: "justify-start", bubble: "border-sky-400/40 bg-sky-500/15 text-sky-100", label: `Creator ${displayNameForWallet(message.senderAddress)}` };
    if (isOpponent) return { align: "justify-end", bubble: "border-violet-400/40 bg-violet-500/15 text-violet-100", label: `Opponent ${displayNameForWallet(message.senderAddress)}` };
    if (isAdmin) return { align: "justify-end", bubble: "border-amber-400/40 bg-amber-500/15 text-amber-100", label: "Admin" };
    if (isSystem) return { align: "justify-center", bubble: "border-white/5 bg-white/5 text-gray-400", label: "System" };
    // fallback for unknown player
    return { align: "justify-start", bubble: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100", label: `Player ${displayNameForWallet(message.senderAddress)}` };
  }

  /* ---- helper: same alignment logic for the inline chat below the main card ---- */
  function getInlineChatStyle(message: DisputeMessageItem) {
    const isAdmin = message.senderRole === "admin";
    const isPlayer = message.senderRole === "player";
    const isSystem = message.senderRole === "system";

    if (isSystem) return { align: "justify-center", bubble: "border-white/5 bg-white/5 text-gray-400", label: "System" };
    if (isAdmin) return { align: "justify-end", bubble: "border-amber-400/40 bg-amber-500/15 text-amber-100", label: "Admin" };
    if (isPlayer) return { align: "justify-start", bubble: "border-sky-400/40 bg-sky-500/15 text-sky-100", label: `Player ${displayNameForWallet(message.senderAddress)}` };
    return { align: "justify-start", bubble: "border-white/10 bg-white/5 text-gray-300", label: "Unknown" };
  }

  /* ---- filtered queue items ---- */
  const filteredQueueItems = useMemo(() => {
    if (queueFilter === "pending") return disputedIds.map((id) => ({ id, type: "pending" as const }));
    if (queueFilter === "completed") return completedDisputeIds.map((id) => ({ id, type: "completed" as const }));
    return [
      ...disputedIds.map((id) => ({ id, type: "pending" as const })),
      ...completedDisputeIds.map((id) => ({ id, type: "completed" as const })),
    ];
  }, [queueFilter, disputedIds, completedDisputeIds]);

  return (
    <PageShell maxWidth="max-w-5xl">
      <div className="animate-fade-in-up">
        {/* ---- Header ---- */}
        <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-black uppercase tracking-tight sm:text-3xl">
            Admin <span className="text-sky-400">Disputes</span>
          </h1>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            {!isConnected ? (
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button
                    type="button"
                    onClick={openConnectModal}
                    className="cursor-pointer rounded-xl border border-sky-500/30 bg-sky-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-sky-300 transition hover:bg-sky-500/20 sm:text-sm"
                  >
                    Link Wallet
                  </button>
                )}
              </ConnectButton.Custom>
            ) : (
              <>
                <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-gray-300">
                  {displayNameForWallet(address)}
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-red-300 transition hover:bg-red-500/20 sm:text-sm"
                  onClick={() => disconnect()}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>

        {/* ---- Password gate ---- */}
        {!authed ? (
          <GlassCard glow hover={false} className="mx-auto max-w-md">
            <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Admin Password</label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="password"
                value={adminPassInput}
                onChange={(e) => setAdminPassInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdminUnlock();
                  }
                }}
                className="flex-1 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-500"
                placeholder="Enter password"
              />
              <button
                className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-5 py-3 text-xs font-bold uppercase tracking-wider text-sky-300 transition hover:bg-sky-500/20"
                onClick={handleAdminUnlock}
              >
                Unlock
              </button>
            </div>
            {passError && <div className="mt-3 text-xs text-red-400">{passError}</div>}
          </GlassCard>
        ) : (
          <div className="space-y-6">
            {/* ---- Warnings ---- */}
            {!chainSupported && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
                Unsupported network. Switch wallet to one of: {getSupportedChainNames()}.
              </div>
            )}
            {!escrowAddress && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
                Escrow address is not configured for this chain.
              </div>
            )}

            {/* ---- Contract admin badge ---- */}
            <GlassCard hover={false}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-gray-400">
                  Contract admin wallet:{" "}
                  <span className="font-mono text-sky-300 break-all">
                    {contractAdmin ? displayNameForWallet(contractAdmin) : "Loading..."}
                  </span>
                </div>
                <div
                  className={
                    isContractAdmin
                      ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200"
                      : "rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200"
                  }
                >
                  {isContractAdmin ? "Escrow admin wallet connected" : "Connect escrow admin wallet to resolve"}
                </div>
              </div>
            </GlassCard>

            {/* ---- Dispute Queue ---- */}
            <GlassCard hover={false}>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold uppercase tracking-wide text-white">Dispute Queue</div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    Auto-sync every 20s
                  </div>
                </div>
                <button
                  className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-300 transition hover:bg-sky-500/20"
                  onClick={loadDisputes}
                  disabled={isLoadingDisputes}
                >
                  {isLoadingDisputes ? "Scanning..." : "Refresh Now"}
                </button>
              </div>

              {disputeError && <div className="mb-4 text-xs text-red-400 break-all">{disputeError}</div>}

              {/* ---- Filter tabs ---- */}
              <div className="mb-4 flex gap-2">
                {(
                  [
                    { key: "all" as QueueFilter, label: "All", count: disputedIds.length + completedDisputeIds.length },
                    { key: "pending" as QueueFilter, label: "Pending", count: disputedIds.length },
                    { key: "completed" as QueueFilter, label: "Completed", count: completedDisputeIds.length },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setQueueFilter(tab.key)}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider transition ${
                      queueFilter === tab.key
                        ? "border border-sky-400/50 bg-sky-500/20 text-sky-200"
                        : "border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                        queueFilter === tab.key
                          ? "bg-sky-400/30 text-sky-100"
                          : "bg-white/10 text-gray-400"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* ---- Queue items list ---- */}
              {filteredQueueItems.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-center text-xs text-gray-500">
                  No disputes in this category.
                </div>
              ) : (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                  {filteredQueueItems.map((item, index) => {
                    const isPending = item.type === "pending";
                    const isSelected = normalizedMatchIdInput === item.id;
                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        type="button"
                        className={`group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-xs transition-all duration-150 ${
                          isSelected
                            ? isPending
                              ? "border-amber-400/60 bg-amber-500/15 text-amber-100 shadow-[0_0_15px_rgba(245,158,11,0.1)]"
                              : "border-emerald-400/60 bg-emerald-500/15 text-emerald-100 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                            : "border-white/10 bg-black/30 text-gray-300 hover:border-white/20 hover:bg-white/5 hover:shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
                        }`}
                        onClick={() => selectMatchFromQueue(item.id, isPending)}
                      >
                        {/* Status dot */}
                        <span
                          className={`h-2 w-2 flex-shrink-0 rounded-full ${
                            isPending ? "bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.6)]" : "bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.6)]"
                          }`}
                        />
                        <span className="flex-1 font-medium">Match #{item.id}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isPending
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {isPending ? "Pending" : "Resolved"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </GlassCard>

            {/* ---- Match ID input ---- */}
            <GlassCard hover={false}>
              <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Match ID / Room Code</label>
              <div className="flex gap-3">
                <input
                  value={matchIdInput}
                  onChange={(e) => setMatchIdInput(e.target.value)}
                  className="flex-1 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-500"
                  placeholder="Enter on-chain ID or 6-digit room code"
                />
                <button
                  className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-5 py-3 text-xs font-bold uppercase tracking-wider text-sky-300 transition hover:bg-sky-500/20"
                  onClick={() => {
                    if (decodedMatchId === null) {
                      setErr("Invalid Match ID / Room Code.");
                      return;
                    }
                    setErr(null);
                    void matchQuery.refetch();
                  }}
                  disabled={decodedMatchId === null}
                >
                  Load
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-400">
                {decodedMatchId !== null
                  ? `Loaded on-chain match ID: ${decodedMatchId.toString()}`
                  : "Enter numeric ID/code only."}
              </div>
            </GlassCard>

            {/* ---- Match details ---- */}
            {data && (
              <GlassCard hover={false}>
                <div className="space-y-3 text-sm">
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
                    <span className="break-all text-sky-400">{creator ? displayNameForWallet(creator) : "-"}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-gray-500">Opponent</span>
                    <span className="break-all text-sky-400">{opponent ? displayNameForWallet(opponent) : "-"}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-gray-500">Proposed Winner</span>
                    <span className="break-all">{proposedWinner ? displayNameForWallet(proposedWinner) : "-"}</span>
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
              </GlassCard>
            )}

            {data && !canResolveInAdmin && (
              <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-xs text-gray-400">
                This match is in <span className="text-sky-300">{statusText}</span>. Admin release buttons are available only for Funded, ResultProposed, or Disputed matches.
              </div>
            )}

            {/* ---- Resolution actions (inline) ---- */}
            {data && canResolveInAdmin && (
              <GlassCard hover={false} glow>
                {isDisputedMatch && (
                  <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-amber-100">
                    Dispute is active for this match. Chat and release controls are available below.
                  </div>
                )}
                <div className="mb-1 text-[10px] uppercase tracking-[0.35em] text-sky-300/80">Resolution Actions</div>
                <div className="mb-3 text-xs text-gray-300">
                  {isDisputedMatch
                    ? "Dispute detected for this match. Choose where escrow funds should be released."
                    : "Match is eligible for admin resolution. Choose where escrow funds should be released."}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-200 transition hover:bg-sky-500/30"
                    disabled={!isContractAdmin || !creator || isResolving}
                    onClick={() =>
                      creator &&
                      requestResolveAction(creator, false, `Release payout to creator (${displayNameForWallet(creator)})`)
                    }
                  >
                    Release to Creator
                  </button>
                  <button
                    className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-200 transition hover:bg-sky-500/30"
                    disabled={!isContractAdmin || !opponent || isResolving}
                    onClick={() =>
                      opponent &&
                      requestResolveAction(opponent, false, `Release payout to opponent (${displayNameForWallet(opponent)})`)
                    }
                  >
                    Release to Opponent
                  </button>
                  <button
                    className="rounded-xl border border-red-500/30 bg-slate-700/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-red-300 transition hover:bg-red-500/15"
                    disabled={!isContractAdmin || isResolving}
                    onClick={() =>
                      requestResolveAction(
                        "0x0000000000000000000000000000000000000000",
                        true,
                        "Refund both creator and opponent",
                      )
                    }
                  >
                    Refund Both
                  </button>
                </div>
                <button
                  type="button"
                  className="mt-3 w-full rounded-xl border border-sky-500/40 bg-sky-500/15 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-100 transition hover:bg-sky-500/25"
                  onClick={() => setShowDisputeModal(true)}
                >
                  Open Dispute Room
                </button>
              </GlassCard>
            )}
            {data && canResolveInAdmin && !isContractAdmin && (
              <div className="text-xs text-amber-300">
                Resolve actions are disabled until the escrow contract admin wallet is connected.
              </div>
            )}
            {isResolving && (
              <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                Admin resolution transaction in progress. Wait for wallet/network confirmation.
              </div>
            )}

            {/* ---- Inline admin chat (below cards) ---- */}
            {data && isDisputedMatch && (
              <GlassCard hover={false}>
                <div className="mb-1 text-[10px] uppercase tracking-[0.35em] text-sky-300/80">Admin Dispute Chat</div>
                <div className="mb-3 text-xs text-gray-300">
                  Send dispute instructions visible to both players in Match Dispute Center.
                </div>
                <textarea
                  value={adminMessageDraft}
                  onChange={(event) => setAdminMessageDraft(event.target.value)}
                  placeholder="Example: Both players upload evidence screenshots within the dispute timeframe."
                  rows={3}
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
                  disabled={!isDisputedMatch}
                />
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    className="rounded-xl border border-sky-500/40 bg-sky-500/25 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-100 transition hover:bg-sky-500/35 disabled:opacity-30"
                    onClick={() => void sendAdminMessage()}
                    disabled={!isDisputedMatch || !isContractAdmin || isResolving}
                  >
                    Send Message
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-amber-500/40 bg-amber-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-30"
                    onClick={() =>
                      void sendAdminMessage(
                        "Admin notice: both players should upload evidence screenshots within the dispute timeframe.",
                      )
                    }
                    disabled={!isDisputedMatch || !isContractAdmin || isResolving}
                  >
                    Send Evidence Reminder
                  </button>
                </div>
                {adminMessageError && (
                  <div className="mt-2 text-xs text-red-300">{adminMessageError}</div>
                )}
              </GlassCard>
            )}

            {/* ---- Inline Dispute Chat timeline ---- */}
            {data && (
              <GlassCard hover={false}>
                <div className="mb-3 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.35em] text-gray-500">
                  <span>Dispute Chat</span>
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[9px] text-sky-200">
                    Timeline
                  </span>
                </div>
                {disputeMessages.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-400">
                    No messages yet for this dispute.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {disputeMessages.map((message) => {
                      const style = getInlineChatStyle(message);
                      return (
                        <div key={message.id} className={`flex ${style.align}`}>
                          <div className={`max-w-[88%] rounded-2xl border px-3 py-2 ${style.bubble}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/70">
                              <span>{style.label}</span>
                              <span>{new Date(message.createdAt).toLocaleString()}</span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed">{message.message}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </GlassCard>
            )}

            {/* ---- Inline Evidence ---- */}
            {data && (
              <GlassCard hover={false}>
                <div className="mb-3 text-[10px] uppercase tracking-[0.35em] text-gray-500">Dispute Evidence</div>
                {evidenceItems.length === 0 ? (
                  <div className="text-xs text-gray-400">
                    No evidence uploaded for this match yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {evidenceItems.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-white/10 bg-slate-900/70 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-400">
                          <span>Uploader: {displayNameForWallet(item.uploader)}</span>
                          <span>{new Date(item.createdAt).toLocaleString()}</span>
                        </div>
                        {item.note && (
                          <p className="mt-2 text-xs text-gray-300">{item.note}</p>
                        )}
                        <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold text-white">{item.attachmentName}</div>
                              <div className="text-[11px] text-gray-400">
                                {formatFileSize(item.attachmentSizeBytes)} | {item.attachmentMimeType}
                              </div>
                            </div>
                            <a
                              href={item.imageDataUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-200 transition hover:bg-sky-500/20"
                            >
                              View Attachment
                            </a>
                          </div>
                        </div>
                        <img
                          src={item.imageDataUrl}
                          alt={item.attachmentName}
                          className="mt-3 max-h-56 w-full rounded-xl border border-white/10 object-contain bg-black/30"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            )}

            {/* ================================================================ */}
            {/* ---- DISPUTE ROOM MODAL ---- */}
            {/* ================================================================ */}
            {showDisputeModal && data && canResolveInAdmin && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
                onClick={() => setShowDisputeModal(false)}
              >
                <div
                  className="w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-6"
                  onClick={(event) => event.stopPropagation()}
                >
                  {/* Modal header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.35em] text-sky-300/80">Dispute Room</div>
                      <h3 className="mt-1 text-2xl font-semibold text-white">Match #{matchKey || "-"}</h3>
                    </div>
                    <button
                      type="button"
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/10"
                      onClick={() => setShowDisputeModal(false)}
                    >
                      Close
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[1fr,320px]">
                    {/* ---- Left column: Chat + compose ---- */}
                    <div className="space-y-3">
                      {/* Policy window */}
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                        <div className="text-[10px] uppercase tracking-[0.35em] text-amber-300/80">Policy Window</div>
                        <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                          <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                            10m evidence priority: <span className="text-amber-200">{formatCountdown(evidenceWindowRemainingSec)}</span>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                            30m policy timeout: <span className="text-amber-200">{formatCountdown(policyWindowRemainingSec)}</span>
                          </div>
                        </div>
                        <div className="mt-2 text-[11px] text-amber-100/90">
                          Creator evidence: {creatorEvidenceCount} | Opponent evidence: {opponentEvidenceCount}
                        </div>
                      </div>

                      {/* Chat feed */}
                      <div className="max-h-[40vh] space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black/40 p-3">
                        <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.35em] text-gray-500">
                          <span>Dispute Chat</span>
                          <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[9px] text-sky-200">
                            Live Feed
                          </span>
                        </div>
                        {disputeMessages.length === 0 ? (
                          <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-400">
                            No messages yet.
                          </div>
                        ) : (
                          disputeMessages.map((message) => {
                            const style = getMessageStyle(message);
                            return (
                              <div key={message.id} className={`flex ${style.align}`}>
                                <div
                                  className={`max-w-[88%] rounded-2xl border px-3 py-2 ${style.bubble}`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/70">
                                    <span>{style.label}</span>
                                    <span>{new Date(message.createdAt).toLocaleString()}</span>
                                  </div>
                                  <p className="mt-1 text-xs leading-relaxed">{message.message}</p>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      {/* Compose */}
                      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
                        <textarea
                          value={adminMessageDraft}
                          onChange={(event) => setAdminMessageDraft(event.target.value)}
                          placeholder="Type a message to both players..."
                          rows={3}
                          className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
                          disabled={!isDisputedMatch}
                        />
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            className="rounded-lg border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-100 transition hover:bg-sky-500/30 disabled:opacity-30"
                            onClick={() => void sendAdminMessage()}
                            disabled={!isDisputedMatch || !isContractAdmin || isResolving}
                          >
                            Send Message
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-500/25 disabled:opacity-30"
                            onClick={() =>
                              void sendAdminMessage(
                                "Admin notice: both players should upload evidence screenshots within 10 minutes. If one side fails to upload within 30 minutes, priority resolution goes to the side with evidence.",
                              )
                            }
                            disabled={!isDisputedMatch || !isContractAdmin || isResolving}
                          >
                            Send Evidence Reminder
                          </button>
                        </div>
                        {adminMessageError && <div className="mt-2 text-xs text-red-300">{adminMessageError}</div>}
                      </div>
                    </div>

                    {/* ---- Right column (sticky sidebar): Evidence + Resolution ---- */}
                    <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
                      {/* Evidence */}
                      <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                        <div className="text-[10px] uppercase tracking-[0.35em] text-gray-500">Evidence Attachments</div>
                        <div className="mt-2 max-h-[35vh] overflow-y-auto pr-1">
                          {evidenceItems.length === 0 ? (
                            <div className="text-xs text-gray-400">No evidence uploaded yet.</div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              {evidenceItems.map((item) => (
                                <div key={item.id} className="group relative">
                                  <button
                                    type="button"
                                    className="w-full overflow-hidden rounded-lg border border-white/10 bg-black/30 transition hover:border-sky-500/40 hover:shadow-[0_0_15px_rgba(14,165,233,0.15)]"
                                    onClick={() => setExpandedEvidenceId(expandedEvidenceId === item.id ? null : item.id)}
                                  >
                                    <img
                                      src={item.imageDataUrl}
                                      alt={item.attachmentName}
                                      className="aspect-square w-full object-cover"
                                    />
                                    <div className="p-1.5">
                                      <div className="truncate text-[10px] font-medium text-white">{item.attachmentName}</div>
                                      <div className="text-[9px] text-gray-500">{displayNameForWallet(item.uploader)}</div>
                                    </div>
                                  </button>
                                  {/* Expanded overlay */}
                                  {expandedEvidenceId === item.id && (
                                    <div
                                      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
                                      onClick={() => setExpandedEvidenceId(null)}
                                    >
                                      <div className="max-h-[85vh] max-w-[85vw]" onClick={(e) => e.stopPropagation()}>
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                          <div className="text-xs text-gray-300">
                                            {item.attachmentName} - {displayNameForWallet(item.uploader)} - {formatFileSize(item.attachmentSizeBytes)}
                                          </div>
                                          <button
                                            type="button"
                                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white transition hover:bg-white/10"
                                            onClick={() => setExpandedEvidenceId(null)}
                                          >
                                            Close
                                          </button>
                                        </div>
                                        {item.note && <p className="mb-2 text-xs text-gray-400">{item.note}</p>}
                                        <img
                                          src={item.imageDataUrl}
                                          alt={item.attachmentName}
                                          className="max-h-[75vh] max-w-full rounded-lg border border-white/10 object-contain"
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Resolution actions */}
                      <div className="rounded-xl border border-sky-500/20 bg-gradient-to-b from-sky-500/10 to-transparent p-3">
                        <div className="text-[10px] uppercase tracking-[0.35em] text-sky-300/80">Resolution Actions</div>
                        {policyWinnerAddress && (
                          <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-emerald-200">
                            30-minute evidence policy winner detected: {policyWinnerAddress.toLowerCase() === creator?.toLowerCase() ? "Creator" : "Opponent"}.
                          </div>
                        )}
                        <div className="mt-3 grid gap-2">
                          <button
                            className="rounded-lg border border-sky-500/40 bg-sky-500/20 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-sky-200 transition hover:bg-sky-500/30 disabled:opacity-30"
                            disabled={!isContractAdmin || !creator || isResolving}
                            onClick={() =>
                              creator &&
                              requestResolveAction(creator, false, `Release payout to creator (${displayNameForWallet(creator)})`)
                            }
                          >
                            Release to Creator
                          </button>
                          <button
                            className="rounded-lg border border-sky-500/40 bg-sky-500/20 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-sky-200 transition hover:bg-sky-500/30 disabled:opacity-30"
                            disabled={!isContractAdmin || !opponent || isResolving}
                            onClick={() =>
                              opponent &&
                              requestResolveAction(opponent, false, `Release payout to opponent (${displayNameForWallet(opponent)})`)
                            }
                          >
                            Release to Opponent
                          </button>
                          <button
                            className="rounded-lg border border-red-500/30 bg-slate-700/20 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-red-300 transition hover:bg-red-500/15 disabled:opacity-30"
                            disabled={!isContractAdmin || isResolving}
                            onClick={() =>
                              requestResolveAction(
                                "0x0000000000000000000000000000000000000000",
                                true,
                                "Refund both creator and opponent",
                              )
                            }
                          >
                            Refund Both
                          </button>
                        </div>
                        {policyWinnerAddress && (
                          <button
                            type="button"
                            className="mt-2 w-full rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-30"
                            disabled={!isContractAdmin || isResolving}
                            onClick={() =>
                              requestResolveAction(
                                policyWinnerAddress,
                                false,
                                `Apply 30m policy winner (${displayNameForWallet(policyWinnerAddress)})`,
                              )
                            }
                          >
                            Apply 30m Policy Winner
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---- Confirm resolve modal ---- */}
            {resolveIntent && (
              <div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
                onClick={() => {
                  if (isResolving) return;
                  setResolveIntent(null);
                }}
              >
                <div
                  className="w-full max-w-lg rounded-2xl border border-red-500/25 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="text-[11px] uppercase tracking-[0.35em] text-red-300/80">Confirm Admin Resolve</div>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Finalize This Match?</h3>
                  <p className="mt-3 text-sm text-gray-300">
                    Action: <span className="text-sky-200">{resolveIntent.label}</span>
                  </p>
                  <p className="mt-2 text-xs text-amber-200/90">
                    This sends an irreversible on-chain admin resolution transaction.
                  </p>
                  <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/10 disabled:opacity-30"
                      onClick={() => setResolveIntent(null)}
                      disabled={isResolving}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-red-500/40 bg-red-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-red-100 transition hover:bg-red-500/30 disabled:opacity-30"
                      onClick={() => void resolveMatch(resolveIntent.winner, resolveIntent.refundBoth)}
                      disabled={isResolving}
                    >
                      {isResolving ? "Resolving..." : "Confirm Resolve"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ---- Status messages ---- */}
            {txHash && (
              <div className="text-xs text-sky-400 break-all">Tx: {txHash}</div>
            )}
            {err && (
              <div className="text-xs text-red-400 break-all">{err}</div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
