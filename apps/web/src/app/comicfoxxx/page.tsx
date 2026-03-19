"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { decodeMatchCode } from "@/lib/matchCode";
import {
  getEscrowAddressForChain,
  getNativeSymbolForChain,
  getSupportedChainNames,
  isSupportedChainId,
} from "@/lib/chains";

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

function formatCountdown(totalSeconds: number | null) {
  if (totalSeconds === null) return "-";
  const safe = Math.max(0, totalSeconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

type MatchData = readonly [Address, Address, bigint, bigint, bigint | number, boolean, boolean, Address];

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
  const [nowMs, setNowMs] = useState(() => Date.now());
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
      setDisputeMessages(messages);
    };
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [matchKey, txHash]);

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
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }

      if (matchKey) {
        const winnerLabel =
          winner && creator && winner.toLowerCase() === creator.toLowerCase()
            ? "creator"
            : winner && opponent && winner.toLowerCase() === opponent.toLowerCase()
              ? "opponent"
              : shortAddress(winner);
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
      const ids = Array.from({ length: count }, (_, i) => BigInt(i));
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
    setDisputeMessages(await loadDisputeMessages(matchKey));
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
            {!isConnected ? (
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button
                    type="button"
                    onClick={openConnectModal}
                    className="cursor-pointer border border-sky-500/30 bg-sky-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-sky-300 sm:text-sm"
                  >
                    Link Wallet
                  </button>
                )}
              </ConnectButton.Custom>
            ) : (
              <>
                <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-gray-300">
                  {shortAddress(address)}
                </div>
                <button
                  type="button"
                  className="border border-red-500/30 bg-red-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-red-300 sm:text-sm"
                  onClick={() => disconnect()}
                >
                  Disconnect
                </button>
              </>
            )}
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdminUnlock();
                  }
                }}
                className="flex-1 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
                placeholder="Enter password"
              />
              <button
                className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-300"
                onClick={handleAdminUnlock}
              >
                Unlock
              </button>
            </div>
            {passError && <div className="mt-3 text-xs text-red-400">{passError}</div>}
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 backdrop-blur-xl">
            {!chainSupported && (
              <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
                Unsupported network. Switch wallet to one of: {getSupportedChainNames()}.
              </div>
            )}
            {!escrowAddress && (
              <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
                Escrow address is not configured for this chain.
              </div>
            )}
            <div className="mb-4 rounded-2xl border border-white/10 bg-black/40 p-3 text-xs">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="text-gray-400">
                  Contract admin wallet:{" "}
                  <span className="font-mono text-sky-300 break-all">{contractAdmin ?? "Loading..."}</span>
                </div>
                <div
                  className={
                    isContractAdmin
                      ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-200"
                      : "rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-200"
                  }
                >
                  {isContractAdmin ? "Escrow admin wallet connected" : "Connect escrow admin wallet to resolve"}
                </div>
              </div>
            </div>

            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Dispute Queue</div>
                <div className="mt-1 text-[11px] text-gray-500">
                  Auto-sync is on (refresh every 20s). Pending: {disputedIds.length} | Completed: {completedDisputeIds.length}
                </div>
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

            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="mb-2 text-[10px] uppercase tracking-[0.35em] text-amber-300/80">Pending Disputes</div>
                {disputedIds.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-gray-400">
                    No pending disputes.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {disputedIds.map((id, index) => (
                      <button
                        key={id}
                        type="button"
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition ${
                          normalizedMatchIdInput === id
                            ? "border-amber-400/60 bg-amber-500/15 text-amber-100"
                            : "border-white/10 bg-black/40 text-gray-300 hover:border-amber-400/50 hover:text-amber-100"
                        }`}
                        onClick={() => selectMatchFromQueue(id, true)}
                      >
                        <span>{index + 1}. Match #{id}</span>
                        <span className="text-[10px] uppercase tracking-wider text-amber-200/80">Open</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="mb-2 text-[10px] uppercase tracking-[0.35em] text-emerald-300/80">Completed Disputes</div>
                {completedDisputeIds.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-gray-400">
                    No completed disputes yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {completedDisputeIds.map((id, index) => (
                      <button
                        key={id}
                        type="button"
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition ${
                          normalizedMatchIdInput === id
                            ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                            : "border-white/10 bg-black/40 text-gray-300 hover:border-emerald-400/50 hover:text-emerald-100"
                        }`}
                        onClick={() => selectMatchFromQueue(id, false)}
                      >
                        <span>{index + 1}. Match #{id}</span>
                        <span className="text-[10px] uppercase tracking-wider text-emerald-200/80">Completed</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

          <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Match ID / Room Code</label>
          <div className="flex gap-3">
            <input
              value={matchIdInput}
              onChange={(e) => setMatchIdInput(e.target.value)}
              className="flex-1 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
              placeholder="Enter on-chain ID or 6-digit room code"
            />
            <button
              className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-300"
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

          {data && !canResolveInAdmin && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-gray-400">
              This match is in <span className="text-sky-300">{statusText}</span>. Admin release buttons are available only for Funded, ResultProposed, or Disputed matches.
            </div>
          )}

          {data && canResolveInAdmin && (
            <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
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
                  className="rounded-2xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-200"
                  disabled={!isContractAdmin || !creator}
                  onClick={() => creator && resolveMatch(creator, false)}
                >
                  Release to Creator
                </button>
                <button
                  className="rounded-2xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-200"
                  disabled={!isContractAdmin || !opponent}
                  onClick={() => opponent && resolveMatch(opponent, false)}
                >
                  Release to Opponent
                </button>
                <button
                  className="rounded-2xl border border-red-500/30 bg-slate-700/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-red-300"
                  disabled={!isContractAdmin}
                  onClick={() => resolveMatch("0x0000000000000000000000000000000000000000", true)}
                >
                  Refund Both
                </button>
              </div>
              <button
                type="button"
                className="mt-3 w-full rounded-2xl border border-sky-500/40 bg-sky-500/15 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-500/25"
                onClick={() => setShowDisputeModal(true)}
              >
                Open Dispute Room
              </button>
            </div>
          )}
          {data && canResolveInAdmin && !isContractAdmin && (
            <div className="mt-2 text-xs text-amber-300">
              Resolve actions are disabled until the escrow contract admin wallet is connected.
            </div>
          )}

          {data && isDisputedMatch && (
            <div className="mt-6 rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-500/10 via-slate-900/40 to-sky-500/5 p-4">
              <div className="mb-1 text-[10px] uppercase tracking-[0.35em] text-sky-300/80">Admin Dispute Chat</div>
              <div className="mb-3 text-xs text-gray-300">
                Send dispute instructions visible to both players in Match Dispute Center.
              </div>
              <textarea
                value={adminMessageDraft}
                onChange={(event) => setAdminMessageDraft(event.target.value)}
                placeholder="Example: Both players upload evidence screenshots within the dispute timeframe."
                rows={3}
                className="w-full rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                disabled={!isDisputedMatch}
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className="rounded-2xl border border-sky-500/40 bg-sky-500/25 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-100 disabled:opacity-30"
                  onClick={() => void sendAdminMessage()}
                  disabled={!isDisputedMatch}
                >
                  Send Message
                </button>
                <button
                  type="button"
                  className="rounded-2xl border border-amber-500/40 bg-amber-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-amber-100 disabled:opacity-30"
                  onClick={() =>
                    void sendAdminMessage(
                      "Admin notice: both players should upload evidence screenshots within the dispute timeframe.",
                    )
                  }
                  disabled={!isDisputedMatch}
                >
                  Send Evidence Reminder
                </button>
              </div>
              {adminMessageError && (
                <div className="mt-2 text-xs text-red-300">{adminMessageError}</div>
              )}
            </div>
          )}

          {data && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-4">
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
                    const isAdminMessage = message.senderRole === "admin";
                    const isPlayerMessage = message.senderRole === "player";
                    return (
                      <div key={message.id} className={`flex ${isAdminMessage ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[88%] rounded-2xl border px-3 py-2 ${
                            isAdminMessage
                              ? "border-sky-500/40 bg-sky-500/20 text-sky-100"
                              : isPlayerMessage
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-100"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/70">
                            <span>
                              {isAdminMessage
                                ? "Admin"
                                : isPlayerMessage
                                  ? `Player ${shortAddress(message.senderAddress)}`
                                  : "System"}
                            </span>
                            <span>{new Date(message.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed">{message.message}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {data && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-4">
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
                      className="rounded-2xl border border-white/10 bg-slate-900/70 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-400">
                        <span>Uploader: {shortAddress(item.uploader)}</span>
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
                            className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-200 hover:bg-sky-500/20"
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
            </div>
          )}

          {showDisputeModal && data && canResolveInAdmin && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
              onClick={() => setShowDisputeModal(false)}
            >
              <div
                className="w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-900/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-6"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.35em] text-sky-300/80">Dispute Room</div>
                    <h3 className="mt-1 text-2xl font-semibold text-white">Match #{matchKey || "-"}</h3>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
                    onClick={() => setShowDisputeModal(false)}
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                      <div className="text-[10px] uppercase tracking-[0.35em] text-amber-300/80">Policy Window</div>
                      <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                        <div className="rounded-xl border border-white/10 bg-black/40 p-2">
                          10m evidence priority: <span className="text-amber-200">{formatCountdown(evidenceWindowRemainingSec)}</span>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/40 p-2">
                          30m policy timeout: <span className="text-amber-200">{formatCountdown(policyWindowRemainingSec)}</span>
                        </div>
                      </div>
                      <div className="mt-2 text-[11px] text-amber-100/90">
                        Creator evidence: {creatorEvidenceCount} | Opponent evidence: {opponentEvidenceCount}
                      </div>
                    </div>

                    <div className="max-h-[40vh] space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-3">
                      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.35em] text-gray-500">
                        <span>Dispute Chat</span>
                        <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[9px] text-sky-200">
                          Live Feed
                        </span>
                      </div>
                      {disputeMessages.length === 0 ? (
                        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-400">
                          No messages yet.
                        </div>
                      ) : (
                        disputeMessages.map((message) => {
                          const isAdminMessage = message.senderRole === "admin";
                          const isPlayerMessage = message.senderRole === "player";
                          return (
                            <div key={message.id} className={`flex ${isAdminMessage ? "justify-end" : "justify-start"}`}>
                              <div
                                className={`max-w-[88%] rounded-2xl border px-3 py-2 ${
                                  isAdminMessage
                                    ? "border-sky-500/40 bg-sky-500/20 text-sky-100"
                                    : isPlayerMessage
                                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                                      : "border-amber-500/30 bg-amber-500/10 text-amber-100"
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/70">
                                  <span>
                                    {isAdminMessage
                                      ? "Admin"
                                      : isPlayerMessage
                                        ? `Player ${shortAddress(message.senderAddress)}`
                                        : "System"}
                                  </span>
                                  <span>{new Date(message.createdAt).toLocaleString()}</span>
                                </div>
                                <p className="mt-1 text-xs leading-relaxed">{message.message}</p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3">
                      <textarea
                        value={adminMessageDraft}
                        onChange={(event) => setAdminMessageDraft(event.target.value)}
                        placeholder="Type a message to both players..."
                        rows={3}
                        className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                        disabled={!isDisputedMatch}
                      />
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-100 disabled:opacity-30"
                          onClick={() => void sendAdminMessage()}
                          disabled={!isDisputedMatch}
                        >
                          Send Message
                        </button>
                        <button
                          type="button"
                          className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 disabled:opacity-30"
                          onClick={() =>
                            void sendAdminMessage(
                              "Admin notice: both players should upload evidence screenshots within 10 minutes. If one side fails to upload within 30 minutes, priority resolution goes to the side with evidence.",
                            )
                          }
                          disabled={!isDisputedMatch}
                        >
                          Send Evidence Reminder
                        </button>
                      </div>
                      {adminMessageError && <div className="mt-2 text-xs text-red-300">{adminMessageError}</div>}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
                      <div className="text-[10px] uppercase tracking-[0.35em] text-gray-500">Evidence Attachments</div>
                      <div className="mt-2 max-h-[40vh] space-y-3 overflow-y-auto pr-1">
                        {evidenceItems.length === 0 ? (
                          <div className="text-xs text-gray-400">No evidence uploaded yet.</div>
                        ) : (
                          evidenceItems.map((item) => (
                            <div key={item.id} className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                              <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
                                <span>{shortAddress(item.uploader)}</span>
                                <span>{new Date(item.createdAt).toLocaleString()}</span>
                              </div>
                              {item.note && <p className="mt-2 text-xs text-gray-300">{item.note}</p>}
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 p-2">
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
                                  className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-200 hover:bg-sky-500/20"
                                >
                                  View
                                </a>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3">
                      <div className="text-[10px] uppercase tracking-[0.35em] text-sky-300/80">Resolution Actions</div>
                      {policyWinnerAddress && (
                        <div className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-emerald-200">
                          30-minute evidence policy winner detected: {policyWinnerAddress.toLowerCase() === creator?.toLowerCase() ? "Creator" : "Opponent"}.
                        </div>
                      )}
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <button
                          className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-200 disabled:opacity-30"
                          disabled={!isContractAdmin || !creator}
                          onClick={() => creator && resolveMatch(creator, false)}
                        >
                          Creator
                        </button>
                        <button
                          className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-200 disabled:opacity-30"
                          disabled={!isContractAdmin || !opponent}
                          onClick={() => opponent && resolveMatch(opponent, false)}
                        >
                          Opponent
                        </button>
                        <button
                          className="rounded-xl border border-red-500/30 bg-slate-700/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-red-300 disabled:opacity-30"
                          disabled={!isContractAdmin}
                          onClick={() => resolveMatch("0x0000000000000000000000000000000000000000", true)}
                        >
                          Refund
                        </button>
                      </div>
                      {policyWinnerAddress && (
                        <button
                          type="button"
                          className="mt-3 w-full rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-emerald-100 disabled:opacity-30"
                          disabled={!isContractAdmin}
                          onClick={() => resolveMatch(policyWinnerAddress, false)}
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





