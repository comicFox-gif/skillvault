"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, use, type ChangeEvent } from "react";
import PageShell from "@/components/PageShell";
import { useActiveMatches } from "@/components/ActiveMatchTracker";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, useChainId, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { decodeEventLog, formatEther, parseEther, zeroAddress, type Address } from "viem";
import { decodeMatchCode, encodeMatchCode } from "@/lib/matchCode";
import { appendDisputeEvidence, loadDisputeEvidence, type DisputeEvidenceItem } from "@/lib/disputeEvidence";
import {
  appendDisputeMessage,
  ensureDisputeAutoMessage,
  loadDisputeMessages,
  type DisputeMessageItem,
} from "@/lib/disputeMessages";
import { loadWalletProfiles } from "@/lib/profile";
import {
  getChainConfig,
  getEscrowAddressForChain,
  getNativeSymbolForChain,
  getSupportedChainNames,
  isSupportedChainId,
} from "@/lib/chains";
import { publishWalletNotification, showBrowserNotification } from "@/lib/notifications";

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
  {
    type: "function",
    name: "resolvedWinner",
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
  { type: "function", name: "concedeDispute", stateMutability: "nonpayable", inputs: [{ name: "matchId", type: "uint256" }], outputs: [] },
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
type HistoryResult = "Win" | "Loss" | "Disputed";
type HistoryEntry = {
  matchId: string;
  opponent: Address;
  result: HistoryResult;
};
type WalletHistory = {
  wins: number;
  losses: number;
  disputes: number;
  entries: HistoryEntry[];
};
type EvidenceAttachment = {
  name: string;
  sizeBytes: number;
  mimeType: string;
  dataUrl: string;
};
type RematchIntent = {
  oldMatchId: string;
  newMatchId: string;
  newRoomCode: string;
  requestedBy: string;
  requestedByRole: "creator" | "opponent";
  creator: string;
  opponent: string;
  stake: string;
  timeframe: string;
  joinMins: string;
  game: string;
  platform: string;
  status: "pending" | "joined" | "cancelled";
  createdAt: number;
  updatedAt: number;
  joinedBy?: string;
  cancelledBy?: string;
};

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MIN_EVIDENCE_BYTES = 40 * 1024;
const EVIDENCE_NOTE_MIN_LENGTH = 12;
const DISPUTE_CLICK_COOLDOWN_MS = 50_000;
const REMATCH_RECEIPT_WAIT_TIMEOUT_MS = 30_000;
const REMATCH_RECEIPT_POLL_INTERVAL_MS = 2_000;
const REMATCH_RPC_CALL_TIMEOUT_MS = 6_000;
const REMATCH_API_TIMEOUT_MS = 12_000;
const REMATCH_RECENT_MATCH_LOOKBACK = 20n;
const REMATCH_CREATED_AT_TOLERANCE_SEC = 20 * 60;
const TX_ACTION_RECEIPT_WAIT_TIMEOUT_MS = 45_000;
const TX_ACTION_RECEIPT_POLL_INTERVAL_MS = 2_000;

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 B";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatCountdown(totalSeconds: number | null) {
  if (totalSeconds === null) return "-";
  const safe = Math.max(0, totalSeconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

function makeAlphabetMask(seed: string, length = 12) {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let state = hash || 1;
  let masked = "";
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    masked += letters[state % letters.length];
  }
  return masked;
}

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

function isMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

function normalizeDisputeMessages(items: DisputeMessageItem[]) {
  const byId = new Map<string, DisputeMessageItem>();
  for (const item of items) {
    if (!item?.id) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read image data."));
    };
    reader.onerror = () => reject(new Error("Failed to read image data."));
    reader.readAsDataURL(blob);
  });
}

async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image."));
    image.src = dataUrl;
  });
}

async function compressImageAttachment(file: File): Promise<EvidenceAttachment> {
  const originalDataUrl = await blobToDataUrl(file);
  const originalName = file.name || "evidence-image";
  const originalAttachment: EvidenceAttachment = {
    name: originalName,
    sizeBytes: file.size,
    mimeType: file.type || "image/*",
    dataUrl: originalDataUrl,
  };

  if (typeof window === "undefined") return originalAttachment;
  if (file.type === "image/gif") return originalAttachment;
  if (file.size <= 1_500_000) return originalAttachment;

  try {
    const image = await loadImageFromDataUrl(originalDataUrl);
    const maxDimension = 1600;
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return originalAttachment;

    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    const compressedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.8);
    });
    if (!compressedBlob) return originalAttachment;

    const compressedDataUrl = await blobToDataUrl(compressedBlob);
    const compressedName = originalName.replace(/\.[a-zA-Z0-9]+$/, "") || "evidence-image";
    const compressedAttachment: EvidenceAttachment = {
      name: `${compressedName}.jpg`,
      sizeBytes: compressedBlob.size,
      mimeType: "image/jpeg",
      dataUrl: compressedDataUrl,
    };

    return compressedAttachment.sizeBytes < originalAttachment.sizeBytes
      ? compressedAttachment
      : originalAttachment;
  } catch {
    return originalAttachment;
  }
}

export default function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switchingChain } = useSwitchChain();
  const requestedChainParam = searchParams.get("c");
  const requestedChainId =
    requestedChainParam && /^\d+$/.test(requestedChainParam)
      ? Number(requestedChainParam)
      : null;
  const requiredChainId = requestedChainId && isSupportedChainId(requestedChainId) ? requestedChainId : chainId;
  const walletBalanceQuery = useBalance({
    address,
    chainId: requiredChainId,
    query: { enabled: Boolean(isConnected && address) },
  });
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  type BaseWriteConfig = Parameters<typeof writeContractAsync>[0];
  type WriteConfig = Omit<BaseWriteConfig, "value" | "nonce"> & {
    value?: bigint;
    nonce?: number;
  };
  const escrowAddress = getEscrowAddressForChain(requiredChainId);
  const nativeSymbol = getNativeSymbolForChain(requiredChainId);
  const chainSupported = isSupportedChainId(requiredChainId);
  const requiredChainName = getChainConfig(requiredChainId)?.name ?? `Chain ${requiredChainId}`;
  const onRequiredChain = chainId === requiredChainId;

  const decodedMatchId = useMemo(() => decodeMatchCode(id), [id]);
  const hasValidRoomCode = decodedMatchId !== null;
  const matchId = decodedMatchId ?? 0n;
  const roomCode = useMemo(() => encodeMatchCode(matchId), [matchId]);

  const matchQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getMatch",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress && hasValidRoomCode && chainSupported && onRequiredChain), refetchInterval: 2000 },
  });
  const matchStorageQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "matches",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress && hasValidRoomCode && chainSupported && onRequiredChain), refetchInterval: 2000 },
  });
  const creatorVoteQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "creatorReportedWinner",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress && hasValidRoomCode && chainSupported && onRequiredChain), refetchInterval: 2000 },
  });
  const opponentVoteQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "opponentReportedWinner",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress && hasValidRoomCode && chainSupported && onRequiredChain), refetchInterval: 2000 },
  });
  const resolvedWinnerQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "resolvedWinner",
    args: [matchId] as const,
    query: { enabled: Boolean(escrowAddress && hasValidRoomCode && chainSupported && onRequiredChain), refetchInterval: 4000 },
  });

  const [txHash, setTxHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [joinedNotice, setJoinedNotice] = useState(false);
  const [cancelCountdown, setCancelCountdown] = useState<number | null>(null);
  const [showLoseConfirm, setShowLoseConfirm] = useState(false);
  const [showDisputeConfirm, setShowDisputeConfirm] = useState(false);
  const [showConcedeDisputeConfirm, setShowConcedeDisputeConfirm] = useState(false);
  const [showAwaitingOpponent, setShowAwaitingOpponent] = useState(false);
  const [historyByWallet, setHistoryByWallet] = useState<Record<string, WalletHistory>>({});
  const [walletUsernames, setWalletUsernames] = useState<Record<string, string>>({});
  const [walletAvatars, setWalletAvatars] = useState<Record<string, string>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [autoJoinTriggered, setAutoJoinTriggered] = useState(false);
  const [joinAfterConnect, setJoinAfterConnect] = useState(false);
  const [isJoinActionPending, setIsJoinActionPending] = useState(false);
  const [isOutcomeSubmitting, setIsOutcomeSubmitting] = useState(false);
  const [isTxActionPending, setIsTxActionPending] = useState(false);
  const [copiedRoomCode, setCopiedRoomCode] = useState(false);
  const [copiedMatchLink, setCopiedMatchLink] = useState(false);
  const [showDisputePanel, setShowDisputePanel] = useState(false);
  const [rematchIntent, setRematchIntent] = useState<RematchIntent | null>(null);
  const [isRematching, setIsRematching] = useState(false);
  const [isRematchDecisionPending, setIsRematchDecisionPending] = useState(false);
  const [rematchJoinStatusText, setRematchJoinStatusText] = useState("");
  const [rematchStatusText, setRematchStatusText] = useState("");
  const [txActionStatusText, setTxActionStatusText] = useState<string | null>(null);
  const [disputeEvidence, setDisputeEvidence] = useState<DisputeEvidenceItem[]>([]);
  const [disputeMessages, setDisputeMessages] = useState<DisputeMessageItem[]>([]);
  const [disputeMessageDraft, setDisputeMessageDraft] = useState("");
  const [disputeMessageError, setDisputeMessageError] = useState<string | null>(null);
  const [isSendingDisputeMessage, setIsSendingDisputeMessage] = useState(false);
  const [evidenceAttachment, setEvidenceAttachment] = useState<EvidenceAttachment | null>(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [disputeCooldownUntilMs, setDisputeCooldownUntilMs] = useState<number | null>(null);
  const [disputeCooldownNowMs, setDisputeCooldownNowMs] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState<"match" | "chat" | "evidence" | "history">("match");
  const { trackMatch, updateMatchStatus } = useActiveMatches();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const openConnectRef = useRef<(() => void) | null>(null);
  const autoJoinConnectPromptedRef = useRef(false);
  const autoOpenedDisputeFor = useRef<string | null>(null);
  const disputeCooldownLockRef = useRef(0);
  const disputeMessagesRequestSeqRef = useRef(0);
  const txActionLockRef = useRef(false);
  const notificationStateRef = useRef<{
    statusNum: number | null;
    proposedWinner: string | null;
    opponentPaid: boolean;
    resolvedWinner: string | null;
  } | null>(null);

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
  const resolvedWinner = resolvedWinnerQuery.data as Address | undefined;

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
  const opponentIsOpen = !opponent || opponent.toLowerCase() === zeroAddress;
  const canJoinMatchState = Boolean(matchExists && statusNum === 0 && !opponentPaid);
  const canJoin = Boolean(
    canJoinMatchState &&
      isConnected &&
      chainSupported &&
      onRequiredChain &&
      !isCreator &&
      (opponentIsOpen || isOpponent),
  );
  const canShowJoinCTA = Boolean(canJoinMatchState && !isCreator && (canJoin || !isConnected));
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
  const timeframeParam = searchParams.get("t");
  const gameParam = searchParams.get("g");
  const platformParam = searchParams.get("p");
  const joinParam = searchParams.get("j");
  const pendingCreate = searchParams.get("pending") === "1";
  const minWinRateParam = searchParams.get("mwr");
  const minWinRate = minWinRateParam && /^\d+$/.test(minWinRateParam) ? Number(minWinRateParam) : 0;
  const rematchTimeframe = timeframeParam && /^\d+$/.test(timeframeParam) ? timeframeParam : "10";
  const rematchGame =
    gameParam === "eFootball" || gameParam === "FC26" || gameParam === "FC25" || gameParam === "Mortal Kombat"
      ? gameParam
      : "eFootball";
  const rematchPlatform =
    platformParam === "Console" || platformParam === "PC" || platformParam === "Mobile"
      ? platformParam
      : "Console";
  const rematchJoinMins = joinParam && /^\d+$/.test(joinParam) ? joinParam : "30";
  const rematchOpponent = isCreator ? opponent : isOpponent ? creator : undefined;
  const invitePath = useMemo(() => {
    if (!hasValidRoomCode) return "";
    const params = new URLSearchParams();
    if (timeframeParam && /^\d+$/.test(timeframeParam)) {
      params.set("t", timeframeParam);
    }
    if (gameParam) {
      params.set("g", gameParam);
    }
    if (platformParam) {
      params.set("p", platformParam);
    }
    if (joinParam && /^\d+$/.test(joinParam)) {
      params.set("j", joinParam);
    }
    params.set("c", String(requiredChainId));
    params.set("auto", "1");
    if (minWinRate > 0) {
      params.set("mwr", String(minWinRate));
    }
    const query = params.toString();
    return `/matches/${encodeURIComponent(roomCode)}${query ? `?${query}` : ""}`;
  }, [hasValidRoomCode, roomCode, searchParams, requiredChainId, minWinRate]);
  const inviteLinkPreview = useMemo(() => {
    if (!invitePath) return "-";
    return `invite://${makeAlphabetMask(invitePath, 14)}`;
  }, [invitePath]);
  const connectedRoleLabel = isConnected
    ? isCreator
      ? "Creator"
      : isOpponent
        ? "Opponent"
        : canJoinMatchState && opponentIsOpen
          ? "Opponent (Ready)"
          : "Spectator"
    : "Connect Wallet";

  function shortAddress(value?: string) {
    if (!value) return "-";
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  function usernameForWallet(value?: string) {
    if (!value) return null;
    return walletUsernames[value.toLowerCase()] ?? null;
  }

  function displayNameForWallet(value?: string) {
    const username = usernameForWallet(value);
    if (username) return username;
    return shortAddress(value);
  }

  function avatarForWallet(value?: string) {
    if (!value) return "";
    return walletAvatars[value.toLowerCase()] ?? "";
  }

  async function handleSwitchRequiredChain() {
    try {
      await switchChainAsync({ chainId: requiredChainId });
    } catch (switchError: any) {
      setErr(
        switchError?.shortMessage ||
          switchError?.message ||
          `Failed to switch network. Please switch to ${requiredChainName} in wallet.`,
      );
    }
  }

  const resolvedWinnerLabel = useMemo(() => {
    const winner = resolvedWinner?.toLowerCase();
    if (!winner || winner === zeroAddress) return "Refunded";
    if (creator && winner === creator.toLowerCase()) {
      return usernameForWallet(creator) ?? "Creator";
    }
    if (opponent && winner === opponent.toLowerCase()) {
      return usernameForWallet(opponent) ?? "Opponent";
    }
    return displayNameForWallet(resolvedWinner);
  }, [resolvedWinner, creator, opponent, walletUsernames]);

  const creatorDisplayName = creator ? displayNameForWallet(creator) : "-";
  const opponentDisplayName = opponent ? displayNameForWallet(opponent) : "-";
  const proposedWinnerDisplayName = proposedWinner
    ? proposedWinner.toLowerCase() === zeroAddress
      ? "-"
      : displayNameForWallet(proposedWinner)
    : "-";
  const matchPagePath = `/matches/${encodeURIComponent(roomCode)}`;

  // Track this match as active so users can return from any page
  useEffect(() => {
    if (!hasValidRoomCode || typeof statusNum !== "number") return;
    trackMatch({
      roomCode,
      matchId: matchId.toString(),
      role: isCreator ? "creator" : isOpponent ? "opponent" : "spectator",
      status: statusNum,
      game: rematchGame,
      opponent: isCreator ? opponentDisplayName : creatorDisplayName,
      stake: `${stakeEth} ${nativeSymbol}`,
    });
  }, [roomCode, statusNum, isCreator, isOpponent]);

  // Keep status synced as match progresses
  useEffect(() => {
    if (!hasValidRoomCode || typeof statusNum !== "number") return;
    updateMatchStatus(roomCode, statusNum);
  }, [statusNum]);

  async function dispatchMatchPushNotification(payload: {
    wallets: Array<string | undefined>;
    title: string;
    body: string;
    tag: string;
    data?: Record<string, unknown>;
  }) {
    const wallets = payload.wallets
      .map((wallet) => String(wallet ?? "").trim().toLowerCase())
      .filter((wallet, index, list) => /^0x[a-f0-9]{40}$/.test(wallet) && list.indexOf(wallet) === index);
    if (!wallets.length) return;

    await publishWalletNotification({
      wallets,
      title: payload.title,
      body: payload.body,
      tag: payload.tag,
      url: matchPagePath,
      data: {
        matchId: matchId.toString(),
        roomCode,
        ...payload.data,
      },
    });
  }

  async function refreshDisputeEvidence() {
    if (!hasValidRoomCode) {
      setDisputeEvidence([]);
      return;
    }
    setDisputeEvidence(await loadDisputeEvidence(matchId.toString()));
  }

  async function refreshDisputeMessages() {
    if (!hasValidRoomCode) {
      setDisputeMessages([]);
      return;
    }
    const requestSeq = ++disputeMessagesRequestSeqRef.current;
    const incoming = await loadDisputeMessages(matchId.toString());
    if (requestSeq !== disputeMessagesRequestSeqRef.current) return;
    setDisputeMessages((previous) => {
      if (incoming.length === 0 && previous.length > 0) {
        // Preserve existing UI history on transient empty fetch responses.
        return previous;
      }
      return normalizeDisputeMessages([...previous, ...incoming]);
    });
  }

  async function sendDisputeMessage() {
    setDisputeMessageError(null);
    if (!isConnected || !address) {
      setDisputeMessageError("Connect wallet to send a dispute message.");
      return;
    }
    if (statusNum !== 4) {
      setDisputeMessageError("Dispute chat is open only while dispute is active.");
      return;
    }
    const message = disputeMessageDraft.trim();
    if (!message) {
      setDisputeMessageError("Message cannot be empty.");
      return;
    }

    setIsSendingDisputeMessage(true);
    try {
      await appendDisputeMessage(matchId.toString(), {
        senderRole: "player",
        senderAddress: address,
        message,
      });
      setDisputeMessageDraft("");
      await refreshDisputeMessages();
    } catch (error: any) {
      setDisputeMessageError(error?.message || "Failed to send dispute message.");
    } finally {
      setIsSendingDisputeMessage(false);
    }
  }

  async function onEvidenceFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setEvidenceError("Only image files are allowed.");
      setEvidenceAttachment(null);
      event.target.value = "";
      return;
    }
    setEvidenceError(null);
    try {
      const attachment = await compressImageAttachment(file);
      if (attachment.sizeBytes > MAX_EVIDENCE_BYTES) {
        setEvidenceError("File is too large. Compress file and upload again.");
        setEvidenceAttachment(null);
        event.target.value = "";
        return;
      }
      setEvidenceAttachment(attachment);
    } catch {
      setEvidenceError("Failed to read image.");
      setEvidenceAttachment(null);
    }
    event.target.value = "";
  }

  async function uploadDisputeEvidence() {
    if (!address) {
      setEvidenceError("Connect wallet to upload evidence.");
      return;
    }
    if (statusNum !== 4) {
      setEvidenceError("Evidence upload is available only while dispute is active.");
      return;
    }
    if (!evidenceAttachment) {
      setEvidenceError("Select an image first.");
      return;
    }
    if (evidenceAttachment.sizeBytes < MIN_EVIDENCE_BYTES) {
      setEvidenceError("Evidence file looks too small. Upload a clear, real match screenshot.");
      return;
    }
    if (evidenceNote.trim().length < EVIDENCE_NOTE_MIN_LENGTH) {
      setEvidenceError("Add a short evidence note (at least 12 characters).");
      return;
    }
    try {
      await appendDisputeEvidence(matchId.toString(), {
        uploader: address,
        note: evidenceNote.trim(),
        imageDataUrl: evidenceAttachment.dataUrl,
        attachmentName: evidenceAttachment.name,
        attachmentSizeBytes: evidenceAttachment.sizeBytes,
        attachmentMimeType: evidenceAttachment.mimeType,
      });
      setEvidenceAttachment(null);
      setEvidenceNote("");
      setEvidenceError(null);
      await refreshDisputeEvidence();
    } catch (error: any) {
      setEvidenceError(error?.message || "Failed to upload evidence.");
    }
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

  const showPostMatchActions = Boolean(statusNum === 5 && isPlayer);

  async function runTx(
    actionLabel: string,
    fn: () => Promise<`0x${string}`>,
    onSuccess?: (hash: `0x${string}`) => void,
  ) {
    if (txActionLockRef.current) return;
    txActionLockRef.current = true;
    setIsTxActionPending(true);
    setTxActionStatusText(`${actionLabel}: confirm in wallet...`);
    setErr(null);
    setTxHash(null);
    try {
      const hash = await fn();
      setTxHash(hash);
      setTxActionStatusText(`${actionLabel}: transaction submitted. Waiting for confirmation...`);
      onSuccess?.(hash);
      window.setTimeout(() => {
        matchQuery.refetch();
        matchStorageQuery.refetch();
        loadWalletHistories();
      }, 600);
      if (publicClient) {
        try {
          await publicClient.waitForTransactionReceipt({
            hash,
            timeout: TX_ACTION_RECEIPT_WAIT_TIMEOUT_MS,
            pollingInterval: TX_ACTION_RECEIPT_POLL_INTERVAL_MS,
          });
          setTxActionStatusText(`${actionLabel}: confirmed on-chain. Syncing state...`);
        } catch {
          setTxActionStatusText(`${actionLabel}: still pending on chain. Syncing latest state...`);
        }
      }
      matchQuery.refetch();
      matchStorageQuery.refetch();
      loadWalletHistories();
      window.setTimeout(() => setTxActionStatusText(null), 4500);
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
      setTxActionStatusText(null);
    } finally {
      txActionLockRef.current = false;
      setIsTxActionPending(false);
    }
  }

  async function refreshRematchIntent() {
    if (!hasValidRoomCode) {
      setRematchIntent(null);
      return;
    }
    try {
      const response = await fetch(`/api/rematch/${encodeURIComponent(matchId.toString())}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { item?: RematchIntent | null };
      setRematchIntent(payload.item ?? null);
    } catch {
      // ignore rematch intent poll errors
    }
  }

  function extractCreatedMatchIdFromReceipt(receipt: any): bigint | null {
    const escrowAddrLower = escrowAddress?.toLowerCase();
    if (!escrowAddrLower) return null;
    for (const log of receipt.logs ?? []) {
      if (!log?.address || String(log.address).toLowerCase() !== escrowAddrLower) continue;
      try {
        const decoded = decodeEventLog({
          abi: escrowAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "MatchCreated") {
          const value = decoded.args.matchId;
          if (typeof value === "bigint") return value;
        }
      } catch {
        // skip non-matching logs
      }
    }
    return null;
  }

  async function resolveCreatedMatchId(
    hash: `0x${string}`,
    expectedId: bigint | null,
  ): Promise<bigint | null> {
    if (!publicClient) return null;
    let trackedHash = hash;
    const startedAt = Date.now();
    while (Date.now() - startedAt < REMATCH_RECEIPT_WAIT_TIMEOUT_MS) {
      let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>> | null = null;
      try {
        receipt = await withTimeout(
          publicClient.getTransactionReceipt({ hash: trackedHash }),
          REMATCH_RPC_CALL_TIMEOUT_MS,
        );
      } catch {
        receipt = null;
      }
      if (!receipt) {
        try {
          const remainingMs = Math.max(
            REMATCH_RECEIPT_POLL_INTERVAL_MS,
            REMATCH_RECEIPT_WAIT_TIMEOUT_MS - (Date.now() - startedAt),
          );
          receipt = await publicClient.waitForTransactionReceipt({
            hash: trackedHash,
            timeout: Math.min(REMATCH_RPC_CALL_TIMEOUT_MS, remainingMs),
            pollingInterval: REMATCH_RECEIPT_POLL_INTERVAL_MS,
            onReplaced: (replacement) => {
              const replacedHash = replacement.transaction.hash;
              if (!replacedHash) return;
              trackedHash = replacedHash;
              setTxHash(replacedHash);
            },
          });
        } catch {
          receipt = null;
        }
      }
      if (receipt) {
        if (receipt.status === "reverted") {
          throw new Error("Rematch transaction reverted on-chain.");
        }
        const fromEvent = extractCreatedMatchIdFromReceipt(receipt);
        if (fromEvent !== null) return fromEvent;
        if (expectedId !== null) return expectedId;
      }
      await new Promise((resolve) => setTimeout(resolve, REMATCH_RECEIPT_POLL_INTERVAL_MS));
    }

    if (expectedId !== null) {
      try {
        const nextId = await withTimeout(
          publicClient.readContract({
            address: escrowAddress!,
            abi: escrowAbi,
            functionName: "nextMatchId",
            args: [],
          }),
          REMATCH_RPC_CALL_TIMEOUT_MS,
        );
        if (typeof nextId === "bigint" && nextId > expectedId) {
          return expectedId;
        }
      } catch {
        // ignore fallback polling error
      }
    }
    return null;
  }

  async function findRecentRematchMatchId(
    creatorAddress: Address,
    opponentAddress: Address,
    stakeAmount: bigint,
  ): Promise<bigint | null> {
    if (!publicClient || !escrowAddress) return null;
    let nextId: bigint | null = null;
    try {
      const next = await withTimeout(
        publicClient.readContract({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "nextMatchId",
          args: [],
        }),
        REMATCH_RPC_CALL_TIMEOUT_MS,
      );
      nextId = typeof next === "bigint" ? next : null;
    } catch {
      nextId = null;
    }
    if (nextId === null || nextId === 0n) return null;

    const creatorLower = creatorAddress.toLowerCase();
    const opponentLower = opponentAddress.toLowerCase();
    const nowSec = Math.floor(Date.now() / 1000);
    const minCreatedAt = Math.max(0, nowSec - REMATCH_CREATED_AT_TOLERANCE_SEC);
    const stopId = nextId > REMATCH_RECENT_MATCH_LOOKBACK ? nextId - REMATCH_RECENT_MATCH_LOOKBACK : 0n;

    let cursor = nextId - 1n;
    while (cursor >= stopId) {
      try {
        const row = (await withTimeout(
          publicClient.readContract({
            address: escrowAddress,
            abi: escrowAbi,
            functionName: "matches",
            args: [cursor],
          }),
          REMATCH_RPC_CALL_TIMEOUT_MS,
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
          return cursor;
        }
      } catch {
        // ignore gaps/read errors and continue scanning backward
      }

      if (cursor === 0n) break;
      cursor -= 1n;
    }

    return null;
  }

  async function startRematchSameStake() {
    if (isRematching) return;
    if (!escrowAddress || !publicClient || !stakeValue || !isPlayer || statusNum !== 5) return;
    if (!rematchOpponent || rematchOpponent.toLowerCase() === zeroAddress) {
      setErr("Rematch unavailable: opponent wallet missing.");
      return;
    }
    if (!isConnected) {
      openConnectRef.current?.();
      return;
    }

    setErr(null);
    setIsRematching(true);
    setRematchStatusText("Preparing rematch settings...");
    try {
      let expectedId: bigint | null = null;
      try {
        const nextId = await withTimeout(
          publicClient.readContract({
            address: escrowAddress,
            abi: escrowAbi,
            functionName: "nextMatchId",
            args: [],
          }),
          REMATCH_RPC_CALL_TIMEOUT_MS,
        );
        expectedId = typeof nextId === "bigint" ? nextId : null;
      } catch {
        expectedId = null;
      }
      const joinBySeconds = BigInt(Math.max(1, Number(rematchJoinMins || "30"))) * 60n;
      const confirmBySeconds = BigInt(Math.max(1, Number(rematchTimeframe || "10"))) * 60n;

      setRematchStatusText("Waiting for wallet confirmation...");
      const hash = await writeWithNonce({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "createMatch",
        args: [rematchOpponent, stakeValue, joinBySeconds, confirmBySeconds] as const,
        value: stakeValue,
      });

      setTxHash(hash);
      setRematchStatusText("Transaction submitted. Finalizing rematch room...");
      let newMatchId = await resolveCreatedMatchId(hash, expectedId);
      if (newMatchId === null && address) {
        setRematchStatusText("Finalizing room code. Scanning latest matches...");
        newMatchId = await findRecentRematchMatchId(address, rematchOpponent, stakeValue);
      }
      if (newMatchId === null) {
        throw new Error("Rematch tx submitted but new room code is still pending. Try again in a few seconds.");
      }

      const newRoomCode = encodeMatchCode(newMatchId);
      const requestedByRole: "creator" | "opponent" = isCreator ? "creator" : "opponent";
      const oldMatchId = matchId.toString();
      setRematchStatusText("Saving rematch invite...");
      const controller = new AbortController();
      const abortId = window.setTimeout(() => controller.abort(), REMATCH_API_TIMEOUT_MS);
      try {
        const response = await fetch(`/api/rematch/${encodeURIComponent(oldMatchId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            intent: {
              newMatchId: newMatchId.toString(),
              newRoomCode,
              requestedBy: address?.toLowerCase() ?? "",
              requestedByRole,
              creator: (creator ?? "").toLowerCase(),
              opponent: (opponent ?? "").toLowerCase(),
              stake: formatEther(stakeValue),
              timeframe: rematchTimeframe,
              joinMins: rematchJoinMins,
              game: rematchGame,
              platform: rematchPlatform,
            },
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || "Failed to save rematch invite.");
        }
      } finally {
        window.clearTimeout(abortId);
      }
      void dispatchMatchPushNotification({
        wallets: [rematchOpponent],
        title: "Rematch requested",
        body: `Room #${roomCode}: your opponent requested a rematch with same stake.`,
        tag: `rematch-requested-${oldMatchId}`,
        data: { type: "rematch_requested", newRoomCode },
      });

      const nextParams = new URLSearchParams();
      nextParams.set("t", rematchTimeframe);
      nextParams.set("g", rematchGame);
      nextParams.set("p", rematchPlatform);
      nextParams.set("j", rematchJoinMins);
      nextParams.set("c", String(requiredChainId));
      nextParams.set("rematchOf", oldMatchId);
      nextParams.set("rematchBy", requestedByRole);
      router.push(`/matches/${encodeURIComponent(newRoomCode)}?${nextParams.toString()}`);
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
    } finally {
      setIsRematching(false);
      setRematchStatusText("");
    }
  }

  async function joinRequestedRematch() {
    if (!rematchIntent) return;
    if (isRematchDecisionPending) return;

    if (!isConnected) {
      openConnectRef.current?.();
      return;
    }
    if (!onRequiredChain) {
      setErr(`Please switch to ${requiredChainName} to join the rematch.`);
      try {
        await switchChainAsync({ chainId: requiredChainId });
      } catch {
        // user rejected chain switch
      }
      return;
    }
    if (!escrowAddress || !publicClient) {
      setErr("Escrow contract not available on this chain.");
      return;
    }

    const rematchStake = rematchIntent.stake
      ? parseEther(rematchIntent.stake)
      : stakeValue;
    if (!rematchStake) {
      setErr("Unable to determine rematch stake amount.");
      return;
    }
    const newMatchIdBigInt = BigInt(rematchIntent.newMatchId);

    setIsRematchDecisionPending(true);
    setRematchJoinStatusText("Confirm in wallet to lock your stake...");
    setErr(null);
    try {
      const hash = await writeWithNonce({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "joinMatch",
        args: [newMatchIdBigInt],
        value: rematchStake,
      });
      setTxHash(hash);
      setRematchJoinStatusText("Transaction submitted. Waiting for confirmation...");

      if (publicClient) {
        try {
          await publicClient.waitForTransactionReceipt({
            hash,
            timeout: REMATCH_RECEIPT_WAIT_TIMEOUT_MS,
            pollingInterval: REMATCH_RECEIPT_POLL_INTERVAL_MS,
          });
          setRematchJoinStatusText("Stake locked! Joining rematch room...");
        } catch {
          setRematchJoinStatusText("Stake tx pending. Joining rematch room...");
        }
      }

      await fetch(`/api/rematch/${encodeURIComponent(matchId.toString())}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", actor: address?.toLowerCase() ?? "" }),
      }).catch(() => undefined);

      void dispatchMatchPushNotification({
        wallets: [rematchIntent.requestedBy],
        title: "Rematch accepted",
        body: `Room #${rematchIntent.newRoomCode}: opponent accepted and locked stake.`,
        tag: `rematch-accepted-${rematchIntent.oldMatchId}`,
        data: { type: "rematch_accepted", newRoomCode: rematchIntent.newRoomCode },
      });

      const params = new URLSearchParams();
      params.set("t", rematchIntent.timeframe);
      params.set("g", rematchIntent.game);
      params.set("p", rematchIntent.platform);
      params.set("j", rematchIntent.joinMins);
      params.set("c", String(requiredChainId));
      params.set("rematchOf", rematchIntent.oldMatchId);
      router.push(`/matches/${encodeURIComponent(rematchIntent.newRoomCode)}?${params.toString()}`);
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || String(e));
    } finally {
      setIsRematchDecisionPending(false);
      setRematchJoinStatusText("");
    }
  }

  async function cancelRequestedRematch() {
    if (!rematchIntent) return;
    if (isRematchDecisionPending) return;
    setIsRematchDecisionPending(true);
    try {
      await fetch(`/api/rematch/${encodeURIComponent(matchId.toString())}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", actor: address?.toLowerCase() ?? "" }),
      }).catch(() => undefined);
      void dispatchMatchPushNotification({
        wallets: [rematchIntent.requestedBy],
        title: "Rematch cancelled",
        body: `Room #${roomCode}: rematch request was cancelled.`,
        tag: `rematch-cancelled-${rematchIntent.oldMatchId}`,
        data: { type: "rematch_cancelled" },
      });
      await refreshRematchIntent();
    } finally {
      setIsRematchDecisionPending(false);
    }
  }

  async function writeWithNonce(config: WriteConfig) {
    if (publicClient && address) {
      const [latestNonce, pendingNonce] = await Promise.all([
        publicClient.getTransactionCount({ address, blockTag: "latest" }),
        publicClient.getTransactionCount({ address, blockTag: "pending" }),
      ]);
      if (pendingNonce > latestNonce) {
        throw new Error("You have a pending wallet transaction. In MetaMask, Speed Up or Cancel it first.");
      }
    }
    return writeContractAsync(config as Parameters<typeof writeContractAsync>[0]);
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
      try {
        const response = await fetch(
          `/api/reputation?chainId=${chainId}&wallets=${encodeURIComponent(trackedWallets.join(","))}`,
          { cache: "no-store" },
        );
        if (response.ok) {
          const payload = (await response.json()) as {
            items?: Record<
              string,
              {
                wins: number;
                losses: number;
                resolved?: number;
                disputes: number;
                noResponseFlags?: number;
                entries: HistoryEntry[];
              }
            >;
          };
          const cached = payload.items ?? {};
          const hasAllWallets = trackedWallets.every((wallet) => Boolean(cached[wallet]));
          if (hasAllWallets) {
            const builtFromCache: Record<string, WalletHistory> = {};
            for (const wallet of trackedWallets) {
              const row = cached[wallet];
              const rawEntries = Array.isArray(row.entries) ? row.entries : [];
              builtFromCache[wallet] = {
                wins: Number(row.wins || 0),
                losses: Number(row.losses || 0),
                disputes: Number(row.disputes || 0),
                entries: rawEntries
                  .filter((e) => e.result === "Win" || e.result === "Loss" || e.result === "Disputed")
                  .slice(0, 6),
              };
            }
            setHistoryByWallet(builtFromCache);
            setHistoryLoading(false);
            return;
          }
        }
      } catch {
        // Continue to on-chain rebuild if backend cache misses/fails.
      }

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
        built[wallet] = { wins: 0, losses: 0, disputes: 0, entries: [] };
      }

      for (const row of snapshots) {
        const [rowCreator, rowOpponent, , , rowStatus, , , rowWinner] = row.data;
        const creatorLower = rowCreator.toLowerCase();
        const opponentLower = rowOpponent.toLowerCase();
        if (opponentLower === zeroAddress) continue;

        const statusVal = Number(rowStatus);
        if (statusVal !== 4 && statusVal !== 5) continue;

        for (const tracked of trackedWallets) {
          const isCreatorWallet = tracked === creatorLower;
          const isOpponentWallet = tracked === opponentLower;
          if (!isCreatorWallet && !isOpponentWallet) continue;

          const walletHistory = built[tracked];
          const rival = (isCreatorWallet ? rowOpponent : rowCreator) as Address;

          let result: HistoryResult;
          if (statusVal === 5) {
            if (rowWinner.toLowerCase() === tracked) {
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
      void fetch("/api/reputation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          byWallet: built,
        }),
      });
    } catch (error: any) {
      setHistoryError(error?.shortMessage || error?.message || String(error));
    } finally {
      setHistoryLoading(false);
    }
  }

  function submitWinClaim() {
    if (!canAct || !address || !canDeclare || isOutcomeSubmitting) return;
    setIsOutcomeSubmitting(true);
    runTx("Submit win claim", () =>
      writeWithNonce({
        address: escrowAddress!,
        abi: escrowAbi,
        functionName: "proposeWinner",
        args: [matchId, address] as const,
      }),
      () => {
        setShowAwaitingOpponent(true);
        void dispatchMatchPushNotification({
          wallets: [isCreator ? opponent : creator],
          title: "Result submitted",
          body: `Room #${roomCode}: your opponent submitted a win claim. Accept or dispute.`,
          tag: `match-result-submitted-${matchId.toString()}`,
          data: { type: "result_submitted" },
        });
      },
    );
  }

  function submitLossClaim() {
    if (!canAct || !opponentAddressForLoss || !canDeclare || isOutcomeSubmitting) return;
    setIsOutcomeSubmitting(true);
    runTx("Submit loss claim", () =>
      writeWithNonce({
        address: escrowAddress!,
        abi: escrowAbi,
        functionName: "proposeWinner",
        args: [matchId, opponentAddressForLoss] as const,
      }),
      () => {
        void dispatchMatchPushNotification({
          wallets: [opponentAddressForLoss],
          title: "Opponent accepted loss",
          body: `Room #${roomCode}: payout is now released to you.`,
          tag: `match-loss-confirmed-${matchId.toString()}`,
          data: { type: "loss_confirmed" },
        });
      },
    );
  }

  function submitDispute() {
    if (!canAct) return;
    const now = Date.now();
    if (now < disputeCooldownLockRef.current) return;
    const until = now + DISPUTE_CLICK_COOLDOWN_MS;
    disputeCooldownLockRef.current = until;
    setDisputeCooldownUntilMs(until);
    setDisputeCooldownNowMs(now);
    runTx(
      "Open dispute",
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
        const starterRole = isCreator ? "creator" : isOpponent ? "opponent" : "unknown";
        void ensureDisputeAutoMessage(matchId.toString(), starterRole);
        void refreshDisputeMessages();
        void dispatchMatchPushNotification({
          wallets: [creator, opponent],
          title: "Dispute started",
          body: `Room #${roomCode}: dispute opened. Upload evidence in dispute center.`,
          tag: `match-dispute-started-${matchId.toString()}`,
          data: { type: "dispute_started", starterRole },
        });
      },
    );
  }

  function openDisputeConfirm() {
    if (!canAct || disputeCooldownActive) return;
    setShowDisputeConfirm(true);
  }

  function submitConcedeDispute() {
    if (!canAct || !isPlayer || statusNum !== 4) return;
    runTx(
      "Concede dispute",
      () =>
        writeWithNonce({
          address: escrowAddress!,
          abi: escrowAbi,
          functionName: "concedeDispute",
          args: [matchId],
        }),
      () => {
        setShowConcedeDisputeConfirm(false);
        setShowDisputePanel(false);
        void dispatchMatchPushNotification({
          wallets: [isCreator ? opponent : creator],
          title: "Dispute conceded",
          body: `Room #${roomCode}: opponent conceded dispute and funds were released.`,
          tag: `match-dispute-conceded-${matchId.toString()}`,
          data: { type: "dispute_conceded" },
        });
      },
    );
  }

  const canAct = Boolean(isConnected && escrowAddress && chainSupported && onRequiredChain);
  const txActionBusy = Boolean(isTxActionPending || isOutcomeSubmitting);
  const matchStarted = Boolean(
    (statusNum === 2 || statusNum === 3 || statusNum === 4) && cancelCountdown === 0,
  );
  const canShowDispute = Boolean(canAct && canDeclare && matchStarted);
  const disputeCooldownRemainingSec =
    disputeCooldownUntilMs === null
      ? 0
      : Math.max(0, Math.ceil((disputeCooldownUntilMs - disputeCooldownNowMs) / 1000));
  const disputeCooldownActive = disputeCooldownRemainingSec > 0;
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
  const showOpponentJoin = Boolean(!isCreator && canShowJoinCTA && typeof stake === "bigint");
  const isSpectator = Boolean(
    hasValidRoomCode &&
      matchExists &&
      !isPlayer &&
      (statusNum !== 0 || opponentPaid || (!opponentIsOpen && isConnected)),
  );
  const canViewDispute = Boolean(statusNum === 4);
  const canSendDisputeMessage = Boolean(
    statusNum === 4 &&
      isPlayer &&
      isConnected &&
      disputeMessageDraft.trim().length > 0 &&
      !isSendingDisputeMessage,
  );
  const walletBalanceText = walletBalanceQuery.data
    ? Number(walletBalanceQuery.data.formatted).toLocaleString(undefined, { maximumFractionDigits: 6 })
    : "-";
  const historyRows = useMemo(
    () =>
      [creator, opponent]
        .filter((wallet): wallet is Address => Boolean(wallet && wallet.toLowerCase() !== zeroAddress))
        .map((wallet) => {
          const key = wallet.toLowerCase();
          const history = historyByWallet[key] ?? {
            wins: 0,
            losses: 0,
            disputes: 0,
            entries: [],
          };
          const role =
            wallet.toLowerCase() === creator?.toLowerCase()
              ? "Creator"
              : wallet.toLowerCase() === opponent?.toLowerCase()
                ? "Opponent"
                : "Player";
          return {
            wallet,
            username: walletUsernames[key] ?? null,
            avatarDataUrl: walletAvatars[key] ?? "",
            role,
            history,
          };
        }),
    [creator, opponent, historyByWallet, walletUsernames, walletAvatars],
  );

  useEffect(() => {
    const wallets = Array.from(
      new Set(
        [
          creator,
          opponent,
          address,
          ...disputeMessages
            .filter((item) => item.senderRole === "player")
            .map((item) => item.senderAddress),
          ...disputeEvidence.map((item) => item.uploader),
          ...Object.keys(historyByWallet),
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
      const nextAvatars: Record<string, string> = {};
      for (const [wallet, profile] of Object.entries(profiles)) {
        const username = profile?.username?.trim();
        const avatar = profile?.avatarDataUrl?.trim();
        if (username) next[wallet] = username;
        if (avatar) nextAvatars[wallet] = avatar;
      }
      setWalletUsernames((previous) => {
        let changed = false;
        const merged = { ...previous };
        for (const [wallet, username] of Object.entries(next)) {
          if (merged[wallet] !== username) {
            merged[wallet] = username;
            changed = true;
          }
        }
        return changed ? merged : previous;
      });
      setWalletAvatars((previous) => {
        let changed = false;
        const merged = { ...previous };
        for (const [wallet, avatar] of Object.entries(nextAvatars)) {
          if (merged[wallet] !== avatar) {
            merged[wallet] = avatar;
            changed = true;
          }
        }
        return changed ? merged : previous;
      });
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [address, creator, opponent, disputeEvidence, disputeMessages, historyByWallet]);

  useEffect(() => {
    if ((statusNum === 1 || statusNum === 2) && opponent) {
      setJoinedNotice(true);
      const timeoutId = setTimeout(() => setJoinedNotice(false), 4000);
      return () => clearTimeout(timeoutId);
    }
    return;
  }, [statusNum, opponent]);

  useEffect(() => {
    if (!hasValidRoomCode || !matchExists || typeof statusNum !== "number") return;

    const current = {
      statusNum,
      proposedWinner:
        proposedWinner && proposedWinner.toLowerCase() !== zeroAddress ? proposedWinner.toLowerCase() : null,
      opponentPaid: Boolean(opponentPaid),
      resolvedWinner:
        resolvedWinner && resolvedWinner.toLowerCase() !== zeroAddress ? resolvedWinner.toLowerCase() : null,
    };
    const previous = notificationStateRef.current;
    notificationStateRef.current = current;
    if (!previous) return;

    const roomTitle = `Room #${roomCode}`;
    const isCurrentWinner = Boolean(address && current.proposedWinner === address.toLowerCase());

    if ((statusNum === 1 || statusNum === 2) && (previous.statusNum === 0 || !previous.opponentPaid) && current.opponentPaid) {
      void showBrowserNotification("Match is about to start", {
        body: `${roomTitle}: both players are now funded.`,
        tag: `match-starting-${matchId.toString()}`,
        url: matchPagePath,
      });
    }

    if (statusNum === 3 && current.proposedWinner && current.proposedWinner !== previous.proposedWinner) {
      if (isCurrentWinner) {
        void showBrowserNotification("Result submitted", {
          body: `${roomTitle}: waiting for opponent to accept or dispute.`,
          tag: `match-result-submitted-${matchId.toString()}`,
          url: matchPagePath,
        });
      } else {
        void showBrowserNotification("Opponent submitted result", {
          body: `${roomTitle}: review outcome and accept or dispute.`,
          tag: `match-result-review-${matchId.toString()}`,
          url: matchPagePath,
          requireInteraction: true,
        });
      }
    }

    if (statusNum === 4 && previous.statusNum !== 4) {
      void showBrowserNotification("Dispute opened", {
        body: `${roomTitle}: upload evidence in dispute center.`,
        tag: `match-dispute-${matchId.toString()}`,
        url: `${matchPagePath}?panel=dispute`,
        requireInteraction: true,
      });
    }

    if (statusNum === 5 && previous.statusNum !== 5) {
      const resolutionText = resolvedWinnerLabel === "Refunded" ? "Dispute resolved with refund." : `Winner: ${resolvedWinnerLabel}.`;
      void showBrowserNotification("Match resolved", {
        body: `${roomTitle}: ${resolutionText}`,
        tag: `match-resolved-${matchId.toString()}`,
        url: matchPagePath,
        requireInteraction: true,
      });
    }
  }, [
    address,
    hasValidRoomCode,
    matchExists,
    matchId,
    matchPagePath,
    opponentPaid,
    proposedWinner,
    resolvedWinner,
    resolvedWinnerLabel,
    roomCode,
    statusNum,
  ]);

  useEffect(() => {
    if (statusNum !== 3 && statusNum !== 4) return;
    if (statusNum === 3 && typeof confirmByRaw !== "bigint") return;
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

  useEffect(() => {
    if (!canViewDispute) {
      setShowDisputePanel(false);
      setDisputeMessageDraft("");
      setDisputeMessageError(null);
      setIsSendingDisputeMessage(false);
    }
    void refreshDisputeEvidence();
    void refreshDisputeMessages();
  }, [canViewDispute, matchId, txHash]);

  useEffect(() => {
    if (!hasValidRoomCode) return;
    if (statusNum !== 4) return;
    const key = matchId.toString();
    void ensureDisputeAutoMessage(key);
    if (autoOpenedDisputeFor.current === key) return;
    autoOpenedDisputeFor.current = key;
    void refreshDisputeEvidence();
    void refreshDisputeMessages();
    setShowDisputePanel(true);
    setActiveTab("chat");
  }, [statusNum, hasValidRoomCode, matchId]);

  useEffect(() => {
    if (!hasValidRoomCode) return;
    if (statusNum !== 5) return;
    void refreshDisputeMessages();
    const intervalId = window.setInterval(() => {
      void refreshDisputeMessages();
    }, 5000);
    const stopId = window.setTimeout(() => window.clearInterval(intervalId), 30000);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(stopId);
    };
  }, [statusNum, hasValidRoomCode, matchId]);

  useEffect(() => {
    if (!hasValidRoomCode) return;
    const key = `dispute-messages:${matchId.toString()}`;
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) {
        void refreshDisputeMessages();
      }
    };
    window.addEventListener("storage", onStorage);
    const intervalId = window.setInterval(() => {
      if (statusNum === 4) {
        void refreshDisputeMessages();
        void refreshDisputeEvidence();
      }
    }, 5000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(intervalId);
    };
  }, [hasValidRoomCode, matchId, statusNum]);

  useEffect(() => {
    if (!disputeCooldownActive) return;
    const timer = window.setInterval(() => setDisputeCooldownNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [disputeCooldownActive]);

  useEffect(() => {
    if (!disputeCooldownUntilMs) return;
    if (disputeCooldownRemainingSec > 0) return;
    setDisputeCooldownUntilMs(null);
    disputeCooldownLockRef.current = 0;
  }, [disputeCooldownUntilMs, disputeCooldownRemainingSec]);

  useEffect(() => {
    if (statusNum !== 4) return;
    setDisputeCooldownUntilMs(null);
    disputeCooldownLockRef.current = 0;
    setShowDisputeConfirm(false);
  }, [statusNum]);

  const disputeIntroMessage = useMemo(
    () => disputeMessages.find((message) => message.senderRole === "system") ?? null,
    [disputeMessages],
  );
  const adminResolutionMessage = useMemo(
    () =>
      [...disputeMessages]
        .reverse()
        .find(
          (message) =>
            message.senderRole === "system" &&
            message.message.trim().toLowerCase().startsWith("dispute resolved by admin"),
        ) ?? null,
    [disputeMessages],
  );
  const adminResolvedTargetLabel = useMemo(() => {
    if (!adminResolutionMessage) return null;
    const winner = resolvedWinner?.toLowerCase();
    if (!winner || winner === zeroAddress) return "both players (refund)";
    if (creator && winner === creator.toLowerCase()) {
      return usernameForWallet(creator) ?? "creator";
    }
    if (opponent && winner === opponent.toLowerCase()) {
      return usernameForWallet(opponent) ?? "opponent";
    }
    return displayNameForWallet(resolvedWinner);
  }, [adminResolutionMessage, resolvedWinner, creator, opponent, walletUsernames]);
  const rematchPendingForCounterparty = Boolean(
    statusNum === 5 &&
      rematchIntent &&
      rematchIntent.status === "pending" &&
      address &&
      address.toLowerCase() !== rematchIntent.requestedBy.toLowerCase(),
  );
  const rematchPendingForRequester = Boolean(
    statusNum === 5 &&
      rematchIntent &&
      rematchIntent.status === "pending" &&
      address &&
      address.toLowerCase() === rematchIntent.requestedBy.toLowerCase(),
  );
  const disputeStartedAtMs = disputeIntroMessage?.createdAt ?? null;
  const disputeElapsedMs = disputeStartedAtMs ? Math.max(0, nowMs - disputeStartedAtMs) : 0;
  const evidenceWindowRemainingSec = disputeStartedAtMs
    ? Math.max(0, Math.floor((10 * 60 * 1000 - disputeElapsedMs) / 1000))
    : null;
  const policyWindowRemainingSec = disputeStartedAtMs
    ? Math.max(0, Math.floor((30 * 60 * 1000 - disputeElapsedMs) / 1000))
    : null;
  const creatorEvidenceCount = disputeEvidence.filter(
    (item) => creator && item.uploader.toLowerCase() === creator.toLowerCase(),
  ).length;
  const opponentEvidenceCount = disputeEvidence.filter(
    (item) => opponent && item.uploader.toLowerCase() === opponent.toLowerCase(),
  ).length;
  const policyWinnerLabel = useMemo(() => {
    if (policyWindowRemainingSec !== 0) return null;
    if (creatorEvidenceCount > 0 && opponentEvidenceCount === 0) return "Creator";
    if (opponentEvidenceCount > 0 && creatorEvidenceCount === 0) return "Opponent";
    return null;
  }, [policyWindowRemainingSec, creatorEvidenceCount, opponentEvidenceCount]);
  const creatorVoted = Boolean(creatorVote && creatorVote.toLowerCase() !== zeroAddress);
  const opponentVoted = Boolean(opponentVote && opponentVote.toLowerCase() !== zeroAddress);
  const timeoutVoteMode = Boolean((creatorVoted && !opponentVoted) || (!creatorVoted && opponentVoted));
  const confirmDeadlineMs =
    typeof confirmByRaw === "bigint" ? Number(confirmByRaw) * 1000 : null;
  const timeoutReached = Boolean(confirmDeadlineMs !== null && nowMs >= confirmDeadlineMs);
  const keeperResolvedByTimeout = Boolean(
    statusNum === 5 &&
      timeoutVoteMode &&
      timeoutReached &&
      !adminResolutionMessage,
  );
  const timeoutNoResponseLabel = useMemo(() => {
    if (!timeoutVoteMode) return null;
    if (creatorVoted && !opponentVoted) return opponent ? displayNameForWallet(opponent) : "opponent";
    if (opponentVoted && !creatorVoted) return creator ? displayNameForWallet(creator) : "opponent";
    return null;
  }, [timeoutVoteMode, creatorVoted, opponentVoted, creator, opponent, walletUsernames]);

  async function joinAndLockStake() {
    if (!stakeValue || !escrowAddress || isJoinActionPending) return;
    setIsJoinActionPending(true);
    await runTx(
      "Join and lock stake",
      () =>
        writeWithNonce({
          address: escrowAddress!,
          abi: escrowAbi,
          functionName: "joinMatch",
          args: [matchId],
          value: stakeValue,
        }),
      () => {
        void dispatchMatchPushNotification({
          wallets: [creator],
          title: "Opponent joined match",
          body: `Room #${roomCode}: opponent locked stake. Match is about to start.`,
          tag: `match-joined-${matchId.toString()}`,
          data: { type: "match_joined" },
        });
        void showBrowserNotification("Stake locked", {
          body: `Room #${roomCode}: you joined and locked your stake.`,
          tag: `match-join-self-${matchId.toString()}`,
          url: matchPagePath,
        });
      },
    );
  }

  function handleJoinClick() {
    if (!canShowJoinCTA || typeof stake !== "bigint" || isJoinActionPending) return;
    if (isConnected && !opponentIsOpen && !isOpponent) {
      setErr(`This match is reserved for opponent ${displayNameForWallet(opponent)}.`);
      return;
    }
    if (minWinRate > 0 && isConnected && address) {
      const myHistory = historyByWallet[address.toLowerCase()];
      if (myHistory) {
        const total = myHistory.wins + myHistory.losses;
        const myWinPct = total > 0 ? Math.round((myHistory.wins / total) * 100) : 0;
        if (total > 0 && myWinPct < minWinRate) {
          setErr(`Creator requires a minimum ${minWinRate}% win rate to join. Your win rate is ${myWinPct}%.`);
          return;
        }
      }
    }
    if (!isConnected) {
      setIsJoinActionPending(true);
      setJoinAfterConnect(true);
      openConnectRef.current?.();
      return;
    }
    void joinAndLockStake();
  }

  useEffect(() => {
    if (!joinAfterConnect || !isConnected) return;
    if (!canJoin || typeof stake !== "bigint") {
      setJoinAfterConnect(false);
      setIsJoinActionPending(false);
      return;
    }
    setJoinAfterConnect(false);
    void joinAndLockStake();
  }, [joinAfterConnect, isConnected, canJoin, stake]);

  useEffect(() => {
    if (!joinAfterConnect || isConnected) return;
    const timeoutId = window.setTimeout(() => {
      setJoinAfterConnect(false);
      setIsJoinActionPending(false);
    }, 15000);
    return () => window.clearTimeout(timeoutId);
  }, [joinAfterConnect, isConnected]);

  useEffect(() => {
    if (!autoJoinRequested) return;
    if (!autoJoinEligible || autoJoinTriggered || isJoinActionPending) return;
    if (!isConnected) return;
    setAutoJoinTriggered(true);
    void joinAndLockStake();
  }, [autoJoinRequested, autoJoinEligible, isConnected, autoJoinTriggered, isJoinActionPending]);

  useEffect(() => {
    if (!autoJoinRequested || isConnected) return;
    if (isMobileBrowser()) return;
    if (autoJoinConnectPromptedRef.current) return;
    autoJoinConnectPromptedRef.current = true;
    setIsJoinActionPending(true);
    openConnectRef.current?.();
  }, [autoJoinRequested, isConnected]);

  useEffect(() => {
    if (!isJoinActionPending) return;
    if (err) {
      setIsJoinActionPending(false);
      return;
    }
    if (statusNum !== 0 || opponentPaid) {
      setIsJoinActionPending(false);
    }
  }, [isJoinActionPending, err, statusNum, opponentPaid]);

  useEffect(() => {
    if (!hasValidRoomCode || !isPlayer || statusNum !== 5) {
      setRematchIntent(null);
      return;
    }
    void refreshRematchIntent();
    const intervalId = window.setInterval(() => {
      void refreshRematchIntent();
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [hasValidRoomCode, isPlayer, statusNum, matchId, txHash]);

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

  const stepperIndex = statusNum === 0 ? 0 : statusNum === 1 ? 1 : statusNum === 2 ? 2 : statusNum === 3 ? 3 : statusNum === 4 ? 4 : statusNum === 5 ? 5 : statusNum === 6 ? 6 : -1;
  const stepperLabels = ["Created", "Joined", "Funded", "Result", "Resolved"];
  const stepperMap = [0, 1, 2, 3, 5];

  return (
    <PageShell maxWidth="max-w-6xl">
      <div className="animate-fade-in-up">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sky-500 mb-1">
              <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
              Match Protocol
            </div>
            <h1 className="text-2xl font-black uppercase italic tracking-tighter text-white sm:text-4xl">
              Match Room{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-sky-200">
                #{hasValidRoomCode ? roomCode : id}
              </span>
            </h1>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
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

        {/* Progress Stepper */}
        {typeof statusNum === "number" && (
          <div className="mb-6 flex items-center justify-between px-2 sm:px-8">
            {stepperLabels.map((label, i) => {
              const targetStatus = stepperMap[i];
              const isCancelled = stepperIndex === 6;
              const isDisputed = stepperIndex === 4;
              const isCurrent = targetStatus === stepperIndex || (i === 4 && (stepperIndex === 4 || stepperIndex === 5));
              const isCompleted = !isCancelled && stepperIndex > targetStatus;
              const isDisputedStep = isDisputed && i === 3;
              const isCancelledStep = isCancelled && i === 0;
              return (
                <div key={label} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-all ${
                        isCancelled && i === 0
                          ? "border-red-500 bg-red-500/30 text-red-200"
                          : isCancelled
                            ? "border-gray-700 bg-gray-800 text-gray-600"
                            : isDisputedStep
                              ? "border-amber-500 bg-amber-500/30 text-amber-200 animate-step-pulse"
                              : isCompleted
                                ? "border-sky-400 bg-sky-400/30 text-sky-200"
                                : isCurrent
                                  ? "border-sky-400 bg-sky-400/30 text-sky-200 animate-step-pulse"
                                  : "border-gray-700 bg-gray-800 text-gray-600"
                      }`}
                    >
                      {isCompleted ? "\u2713" : i + 1}
                    </div>
                    <span className={`mt-1 text-[9px] uppercase tracking-wider ${
                      isCancelled && i === 0 ? "text-red-400" : isDisputedStep ? "text-amber-400" : isCompleted || isCurrent ? "text-sky-400" : "text-gray-600"
                    }`}>
                      {isDisputedStep ? "Disputed" : isCancelledStep ? "Cancelled" : label}
                    </span>
                  </div>
                  {i < stepperLabels.length - 1 && (
                    <div className={`mx-1 h-0.5 flex-1 ${isCompleted && !isCancelled ? "bg-sky-400/50" : "bg-gray-700/50"}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Tabs — chat & evidence only visible during/after dispute */}
        <div className="flex border-b border-white/10 mb-4">
          {(["match", "chat", "evidence", "history"] as const)
            .filter(tab => {
              if (tab === "chat" || tab === "evidence") return statusNum === 4 || statusNum === 5;
              return true;
            })
            .map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors relative ${
                activeTab === tab ? "text-sky-400" : "text-gray-500 hover:text-white"
              }`}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-400 rounded-full" />}
            </button>
          ))}
        </div>

        {!escrowAddress && (
          <div className="mb-6 border border-red-500/20 bg-red-500/10 p-4 text-red-400 font-mono text-sm">
            Escrow address not configured for required chain.
          </div>
        )}
        {!chainSupported && (
          <div className="mb-6 border border-red-500/20 bg-red-500/10 p-4 text-red-400 font-mono text-sm">
            Unsupported required chain. Switch wallet to one of: {getSupportedChainNames()}.
          </div>
        )}
        {chainSupported && !onRequiredChain && (
          <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-100">
            <div className="font-bold uppercase tracking-wider">Wrong network for this room.</div>
            <div className="mt-1">
              This match was created on <span className="font-semibold">{requiredChainName}</span>. Switch network to continue.
            </div>
            <button
              type="button"
              onClick={() => void handleSwitchRequiredChain()}
              disabled={switchingChain}
              className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 disabled:opacity-60"
            >
              {switchingChain ? "Switching..." : `Switch To ${requiredChainName}`}
            </button>
          </div>
        )}

        <ConnectButton.Custom>
          {({ openConnectModal }) => {
            openConnectRef.current = openConnectModal;
            return null;
          }}
        </ConnectButton.Custom>

        {/* ===== MATCH TAB ===== */}
        {activeTab === "match" && (
        <div className="grid gap-8 lg:grid-cols-12">
          {/* Left Column: Status */}
          <div className="min-w-0 lg:col-span-7">
            {/* Status Banner */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(59,130,246,0.12),transparent_45%)]" />
              <div className="relative rounded-[22px] bg-slate-900/90 p-4 backdrop-blur-xl sm:p-6">
                <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Current Status</div>
                <div className="mt-2 text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">{statusText}</div>
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
                  <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    <div className="uppercase tracking-widest">Keeper timeout in {timeoutSecondsLeft}s</div>
                    <div className="mt-1 text-[11px] text-amber-100/90">
                      If one player selected outcome and the opponent refuses to respond, keeper bot will release funds
                      to the selected winner at timeout.
                    </div>
                  </div>
                )}
                {statusNum === 3 && timeoutSecondsLeft === 0 && (
                  <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
                    <div className="uppercase tracking-widest">Timeout reached. Keeper bot is finalizing now.</div>
                    <div className="mt-1 text-[11px] text-sky-100/90">
                      Funds will be released against the opponent that refused to select outcome.
                    </div>
                  </div>
                )}
                {statusNum === 5 && (
                  <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    <div className="uppercase tracking-widest">Match resolved on-chain. Winner: {resolvedWinnerLabel}</div>
                    {keeperResolvedByTimeout && (
                      <div className="mt-1 text-[11px] text-emerald-100/90">
                        Game concluded by keeper bot after timeout. No-response player: {timeoutNoResponseLabel ?? "opponent"}.
                      </div>
                    )}
                    {adminResolutionMessage && (
                      <div className="mt-1 text-[11px] text-emerald-100/90">
                        Match has been resolved by admin. Funds were released to {adminResolvedTargetLabel}.
                      </div>
                    )}
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
                    <div className="mt-1 text-2xl font-black tracking-tight text-emerald-200 sm:text-4xl">
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
          </div>

          {/* Right Column: Actions */}
          <div className="min-w-0 lg:col-span-5 space-y-6">
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
                      {pendingCreate
                        ? "Finalizing match creation on-chain... this can take a few seconds. Keep this page open."
                        : "Match not found. Confirm you are on the same network and using a valid room code."}
                    </div>
                  )}
                  {isSpectator && (
                    <div className="w-full rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4 text-center text-xs text-violet-200">
                      <span className="font-bold uppercase tracking-wider">Spectating</span>
                      <span className="ml-2 text-violet-300/70">You are viewing this match as a spectator</span>
                    </div>
                  )}
                  {showCreatorWaiting && (
                    <div className="w-full rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-center text-xs font-bold uppercase tracking-wider text-sky-200">
                      Waiting for Opponent to Join
                    </div>
                  )}
                  {minWinRate > 0 && !isCreator && statusNum === 0 && (
                    <div className="w-full rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-center text-[11px] text-amber-200">
                      Creator requires minimum <span className="font-bold">{minWinRate}%</span> win rate to join this match.
                    </div>
                  )}
                  {showOpponentJoin && (
                    <button
                      className="w-full rounded-2xl border border-sky-500/40 bg-sky-500/20 p-4 font-bold uppercase tracking-wider text-sky-100 transition-all hover:bg-sky-500/30 disabled:opacity-20 disabled:cursor-not-allowed disabled:bg-gray-800"
                      onClick={handleJoinClick}
                      disabled={isJoinActionPending || isTxActionPending || !canShowJoinCTA}
                    >
                      {isJoinActionPending
                        ? "Processing..."
                        : !isConnected
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
                          disabled={!canAct || txActionBusy}
                          onClick={() =>
                            runTx("Accept opponent result", () =>
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
                          disabled={!canAct || disputeCooldownActive || isTxActionPending}
                          onClick={openDisputeConfirm}
                        >
                          {disputeCooldownActive
                            ? `Dispute Started Already (${disputeCooldownRemainingSec}s)`
                            : "Cancel To Dispute"}
                        </button>
                      </div>
                    </div>
                  )}

                <div className={`grid grid-cols-1 gap-3 ${canShowDispute ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
                  {canShowDispute && (
                    <button
                      className="rounded-2xl border border-red-500/30 bg-slate-700/20 p-3 font-bold uppercase tracking-wider text-red-500 transition-all hover:bg-red-900/20 disabled:opacity-20"
                      disabled={!canAct || disputeCooldownActive || isTxActionPending}
                      onClick={openDisputeConfirm}
                    >
                      {disputeCooldownActive
                        ? `Dispute Started Already (${disputeCooldownRemainingSec}s)`
                        : "Dispute"}
                    </button>
                  )}
                    <button
                      className="rounded-2xl border border-red-500/30 bg-slate-700/20 p-3 font-bold uppercase tracking-wider text-red-500 transition-all hover:bg-red-900/20 disabled:opacity-20"
                      disabled={!canCancel || isTxActionPending || isJoinActionPending}
                      onClick={() =>
                        runTx("Cancel match", () =>
                          writeWithNonce({
                            address: escrowAddress!,
                            abi: escrowAbi,
                            functionName: "cancel",
                            args: [matchId],
                          }),
                        )
                      }
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
                  {disputeCooldownActive && (
                    <p className="text-[11px] text-amber-300/90">
                      Dispute started already. Please wait {disputeCooldownRemainingSec}s before trying again.
                    </p>
                  )}
                  {(statusNum === 2 || statusNum === 3) && cancelCountdown !== null && cancelCountdown > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-black/50 p-3 text-xs text-gray-400">
                      Outcome controls unlock after the 60-second grace period. Time left: {cancelCountdown}s.
                    </div>
                  )}
                  {canViewDispute && (
                    <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4">
                      <div className="text-[10px] uppercase tracking-[0.35em] text-amber-300/80">
                        Dispute Center
                      </div>
                      <p className="mt-2 text-xs text-amber-100/90">
                        Dispute is active. Players can open dispute now and upload evidence later.
                      </p>
                      <button
                        type="button"
                        className="mt-3 w-full rounded-2xl border border-amber-500/40 bg-amber-500/15 p-3 text-xs font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-500/25"
                        onClick={() => {
                          void refreshDisputeEvidence();
                          void refreshDisputeMessages();
                          setShowDisputePanel(true);
                        }}
                      >
                        View Dispute
                      </button>
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
                        disabled={!canAct || !canDeclare || !address || txActionBusy}
                        className="rounded-2xl border border-sky-500/60 bg-sky-500/20 p-3 text-sm font-bold uppercase tracking-wider text-sky-100 transition hover:bg-sky-500/30 disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        {isOutcomeSubmitting ? "Submitting..." : "I won"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowLoseConfirm(true)}
                        disabled={!canAct || !canDeclare || !opponentAddressForLoss || txActionBusy}
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
                        Waiting for opponent declaration. If they do nothing until timeout, keeper bot will auto-finalize and release your payout.
                      </div>
                    )}
                    {statusNum === 3 && timeoutSecondsLeft !== null && (
                      <div className="mt-2 text-xs text-gray-400">
                        Keeper timeout window: {timeoutSecondsLeft > 0 ? `${timeoutSecondsLeft}s left` : "ready now"}.
                        {" "}
                        After timeout, funds are released against opponent no-response.
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
                    Outcome already submitted. Waiting for opponent response or keeper timeout. If opponent refuses,
                    keeper bot will finalize and release funds automatically. You can still open dispute.
                  </div>
                )}

                {showPostMatchActions && (
                  <div className="mt-6 border-t border-white/10 pt-4">
                    <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Next Match</div>
                    {rematchPendingForCounterparty && rematchIntent && (
                      <div className="mb-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-xs text-sky-100">
                        <div className="font-bold text-sm text-sky-50 mb-1">Rematch Requested</div>
                        <p>
                          {rematchIntent.requestedByRole === "creator" ? "Creator" : "Opponent"} wants to rematch with
                          the same stake of{" "}
                          <span className="font-bold text-white">{rematchIntent.stake} {nativeSymbol}</span>.
                          Accept to lock your stake and join, or decline.
                        </p>
                        {!isConnected && (
                          <p className="mt-2 text-amber-200">
                            Connect your wallet to accept the rematch.
                          </p>
                        )}
                        {isConnected && !onRequiredChain && (
                          <p className="mt-2 text-amber-200">
                            Switch to {requiredChainName} to accept.
                          </p>
                        )}
                        {rematchJoinStatusText && (
                          <div className="mt-2 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sky-200">
                            {rematchJoinStatusText}
                          </div>
                        )}
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            className="rounded-xl border border-emerald-500/40 bg-emerald-500/25 px-3 py-2 font-bold uppercase tracking-wider text-emerald-50 disabled:opacity-30"
                            onClick={() => void joinRequestedRematch()}
                            disabled={isRematchDecisionPending || isTxActionPending}
                          >
                            {isRematchDecisionPending ? "Locking Stake..." : "Accept & Lock Stake"}
                          </button>
                          <button
                            type="button"
                            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 font-bold uppercase tracking-wider text-red-100 disabled:opacity-30"
                            onClick={() => void cancelRequestedRematch()}
                            disabled={isRematchDecisionPending}
                          >
                            {isRematchDecisionPending ? "Processing..." : "Decline"}
                          </button>
                        </div>
                      </div>
                    )}
                    {rematchPendingForRequester && rematchIntent && (
                      <div className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                        Rematch request sent. Waiting for opponent to join room #{rematchIntent.newRoomCode}.
                      </div>
                    )}
                    {statusNum === 5 && rematchIntent?.status === "cancelled" && (
                      <div className="mb-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                        Rematch request was cancelled.
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => void startRematchSameStake()}
                        disabled={isRematching || isRematchDecisionPending || !isPlayer || !stakeValue || !rematchOpponent}
                        className="rounded-2xl border border-emerald-500/40 bg-emerald-500/20 p-3 text-center text-xs font-bold uppercase tracking-wider text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-40"
                      >
                        Rematch Same Stake
                      </button>
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
                {txActionStatusText && (
                  <div className="mt-3 rounded-2xl border border-sky-500/25 bg-sky-500/10 p-3 text-xs text-sky-100">
                    {txActionStatusText}
                  </div>
                )}
                {err && <div className="mt-2 text-xs text-red-500 break-all bg-red-900/20 p-2 border border-red-500/20">{err}</div>}
              </div>
            </div>
          </div>

          {/* Left Column: Match Data */}
          <div className="min-w-0 lg:col-span-7">
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
                  <span className="text-gray-500">Your Role</span>
                  <span
                    className={`inline-flex w-fit items-center rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider sm:w-auto ${
                      connectedRoleLabel === "Creator"
                        ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
                        : connectedRoleLabel.startsWith("Opponent")
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : connectedRoleLabel === "Spectator"
                            ? "border-violet-500/30 bg-violet-500/10 text-violet-200"
                            : "border-white/15 bg-white/5 text-gray-300"
                    }`}
                  >
                    {connectedRoleLabel}
                  </span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Creator</span>
                  <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {creator && avatarForWallet(creator) && (
                      <img src={avatarForWallet(creator)} alt={creatorDisplayName} className="h-6 w-6 rounded-full border border-white/10 object-cover" />
                    )}
                    <span className="text-sky-400 break-all sm:text-right">{creatorDisplayName}</span>
                    {creator && (
                      <span className="text-[10px] text-gray-500">{shortAddress(creator)}</span>
                    )}
                    {isCreator && (
                      <span className="inline-flex items-center rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-200">
                        You
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex flex-col gap-1 border-b border-white/5 pb-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-gray-500">Opponent</span>
                  <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {opponent && avatarForWallet(opponent) && (
                      <img src={avatarForWallet(opponent)} alt={opponentDisplayName} className="h-6 w-6 rounded-full border border-white/10 object-cover" />
                    )}
                    <span className="text-sky-400 break-all sm:text-right">{opponentDisplayName}</span>
                    {opponent && (
                      <span className="text-[10px] text-gray-500">{shortAddress(opponent)}</span>
                    )}
                    {isOpponent && (
                      <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
                        You
                      </span>
                    )}
                  </span>
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
                  <span className="text-white break-all sm:text-right">{proposedWinnerDisplayName}</span>
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
          </div>
        </div>
        )}

        {/* ===== CHAT TAB ===== */}
        {activeTab === "chat" && (
          <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-5 backdrop-blur-xl sm:p-6">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
              <div className="h-1 w-4 bg-amber-500" />
              Dispute Chat
            </h3>
            {statusNum !== 4 && statusNum !== 5 && (
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-center text-xs text-gray-500">
                Dispute chat is only available during or after a dispute.
              </div>
            )}
            {(statusNum === 4 || statusNum === 5) && (
              <>
                {disputeMessages.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-400">
                    No messages yet. Admin will post updates here.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                    {disputeMessages.map((message) => {
                      const isAdmin = message.senderRole === "admin";
                      const isSystem = message.senderRole === "system";
                      const isPlayerMessage = message.senderRole === "player";
                      const isCreatorMsg = isPlayerMessage && creator && message.senderAddress.toLowerCase() === creator.toLowerCase();
                      const isOpponentMsg = isPlayerMessage && opponent && message.senderAddress.toLowerCase() === opponent.toLowerCase();
                      const isSelf = isPlayerMessage && Boolean(address) && message.senderAddress.toLowerCase() === String(address).toLowerCase();
                      return (
                        <div
                          key={message.id}
                          className={`flex ${isAdmin || isSystem ? "justify-center" : isOpponentMsg ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[88%] rounded-2xl px-3 py-2 ${
                              isAdmin
                                ? "border border-amber-500/40 bg-amber-500/15 text-amber-100 border-l-4 border-l-amber-400 border-r-4 border-r-amber-400"
                                : isSystem
                                  ? "border border-gray-500/30 bg-gray-500/10 text-gray-300"
                                  : isCreatorMsg
                                    ? "border border-sky-500/30 bg-sky-500/10 text-sky-100 border-l-4 border-l-sky-400"
                                    : isOpponentMsg
                                      ? "border border-violet-500/30 bg-violet-500/10 text-violet-100 border-r-4 border-r-violet-400"
                                      : "border border-white/10 bg-white/5 text-gray-300"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/70">
                              <span>
                                {isAdmin
                                  ? "Admin"
                                  : isPlayerMessage
                                    ? isSelf
                                      ? "You"
                                      : `Player ${displayNameForWallet(message.senderAddress)}`
                                    : "System"}
                              </span>
                              <span className="text-[9px] text-gray-500">{new Date(message.createdAt).toLocaleTimeString()}</span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed">{message.message}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {statusNum === 4 && isPlayer && (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <textarea
                      value={disputeMessageDraft}
                      onChange={(event) => {
                        setDisputeMessageDraft(event.target.value);
                        if (disputeMessageError) setDisputeMessageError(null);
                      }}
                      placeholder="Send a dispute message to admin and opponent..."
                      rows={2}
                      className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-sky-500"
                      disabled={!isConnected || isSendingDisputeMessage}
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-500">
                        Social handles are automatically blocked for player messages.
                      </span>
                      <button
                        type="button"
                        className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-500/30 disabled:opacity-30"
                        onClick={() => void sendDisputeMessage()}
                        disabled={!canSendDisputeMessage}
                      >
                        {isSendingDisputeMessage ? "Sending..." : "Send Message"}
                      </button>
                    </div>
                    {disputeMessageError && (
                      <div className="mt-2 text-xs text-red-300">{disputeMessageError}</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ===== EVIDENCE TAB ===== */}
        {activeTab === "evidence" && (
          <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-5 backdrop-blur-xl sm:p-6">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
              <div className="h-1 w-4 bg-sky-500" />
              Evidence
            </h3>
            {statusNum === 4 && (
              <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-[10px] uppercase tracking-[0.35em] text-amber-300/80">
                  Dispute Policy Window
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-black/40 p-2">
                    Evidence upload priority: <span className="text-amber-200">{formatCountdown(evidenceWindowRemainingSec)}</span>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-2">
                    30m policy timeout: <span className="text-amber-200">{formatCountdown(policyWindowRemainingSec)}</span>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-amber-100/90">
                  Creator evidence: {creatorEvidenceCount} | Opponent evidence: {opponentEvidenceCount}
                </div>
                {policyWinnerLabel && (
                  <div className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-emerald-200">
                    30-minute policy condition met. Current winner by evidence policy: {policyWinnerLabel}.
                  </div>
                )}
              </div>
            )}
            {statusNum === 4 && isPlayer && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-black/40 p-3">
                <input
                  id="evidence-tab-upload"
                  type="file"
                  accept="image/*"
                  onChange={(event) => void onEvidenceFileChange(event)}
                  className="sr-only"
                />
                <label
                  htmlFor="evidence-tab-upload"
                  className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-sky-400/50 bg-sky-500/10 px-4 py-4 transition hover:bg-sky-500/15"
                >
                  <div className="rounded-xl border border-sky-400/60 bg-sky-500/20 p-2 text-sky-100">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 16V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M7 9L12 4L17 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M5 20H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-sky-100">
                      Click Here To Upload Evidence
                    </div>
                    <div className="text-[11px] text-sky-200/90">Attachment only. Max file size: 5MB.</div>
                  </div>
                </label>
                {evidenceAttachment && (
                  <div className="mt-3 rounded-2xl border border-white/15 bg-slate-900/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-white">{evidenceAttachment.name}</div>
                        <div className="text-[11px] text-gray-400">{formatFileSize(evidenceAttachment.sizeBytes)} | {evidenceAttachment.mimeType}</div>
                      </div>
                      <button
                        type="button"
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-200 hover:bg-white/10"
                        onClick={() => setEvidenceAttachment(null)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
                <textarea
                  value={evidenceNote}
                  onChange={(event) => setEvidenceNote(event.target.value)}
                  placeholder="Required note: include scoreline and what the screenshot proves"
                  className="mt-3 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-sky-500"
                  rows={3}
                />
                {evidenceError && <div className="mt-2 text-xs text-red-300">{evidenceError}</div>}
                <button
                  type="button"
                  className="mt-3 rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-500/30 disabled:opacity-30"
                  onClick={() => void uploadDisputeEvidence()}
                  disabled={!isPlayer || !isConnected || !evidenceAttachment}
                >
                  Upload Evidence
                </button>
              </div>
            )}
            {/* Evidence Thumbnail Grid */}
            {disputeEvidence.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-center text-xs text-gray-500">
                No dispute evidence uploaded yet.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {disputeEvidence.map((item) => (
                  <div key={item.id} className="group rounded-2xl border border-white/10 bg-black/40 p-2 hover:border-sky-500/30 transition-colors">
                    <button
                      type="button"
                      className="w-full"
                      onClick={() => setLightboxUrl(item.imageDataUrl)}
                    >
                      <img
                        src={item.imageDataUrl}
                        alt={item.attachmentName}
                        className="w-full aspect-square object-cover rounded-xl"
                      />
                    </button>
                    <div className="mt-2 px-1">
                      <div className="text-[10px] text-gray-400 truncate">{displayNameForWallet(item.uploader)}</div>
                      {item.note && <p className="text-[10px] text-gray-500 truncate mt-0.5">{item.note}</p>}
                      <div className="text-[9px] text-gray-600 mt-0.5">{new Date(item.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== HISTORY TAB ===== */}
        {activeTab === "history" && (
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
            <>
              {historyRows.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-center text-xs text-gray-500">
                  No player history available yet.
                </div>
              )}
              {historyRows.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {historyRows.map((row) => (
                    <div key={row.wallet} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <div className="flex items-center gap-3 mb-4">
                        {row.avatarDataUrl ? (
                          <img src={row.avatarDataUrl} alt={row.username ?? shortAddress(row.wallet)} className="h-8 w-8 rounded-full border border-white/10 object-cover" />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[10px] font-bold text-gray-400">
                            {(row.username ?? row.wallet).slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-white">
                              {row.username ?? shortAddress(row.wallet)}
                            </span>
                            <span className="shrink-0 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-sky-300">
                              {row.role}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-500 truncate">{shortAddress(row.wallet)}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-center">
                          <div className="text-lg font-bold text-emerald-300">{row.history.wins}</div>
                          <div className="text-[10px] uppercase tracking-wider text-emerald-400/70">Wins</div>
                        </div>
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-center">
                          <div className="text-lg font-bold text-red-300">{row.history.losses}</div>
                          <div className="text-[10px] uppercase tracking-wider text-red-400/70">Losses</div>
                        </div>
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-center">
                          <div className="text-lg font-bold text-amber-300">{row.history.disputes}</div>
                          <div className="text-[10px] uppercase tracking-wider text-amber-400/70">Disputes</div>
                        </div>
                      </div>
                      {(() => {
                        const total = row.history.wins + row.history.losses;
                        const winPct = total > 0 ? Math.round((row.history.wins / total) * 100) : 0;
                        return (
                          <div className="mt-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] uppercase tracking-wider text-gray-400">Win Rate</span>
                              <span className="text-xs font-bold text-white">{total > 0 ? `${winPct}%` : "-"}</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                              {total > 0 && (
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                                  style={{ width: `${winPct}%` }}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        )}

        {/* Sticky Mobile Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden">
          <div className="border-t border-white/10 bg-slate-900/80 backdrop-blur-xl px-4 py-3">
            {statusNum === 0 && showCreatorWaiting && (
              <button
                type="button"
                className="w-full rounded-2xl border border-sky-500/40 bg-sky-500/20 p-3 text-xs font-bold uppercase tracking-wider text-sky-100 transition hover:bg-sky-500/30"
                onClick={copyMatchLinkValue}
              >
                {copiedMatchLink ? "Link Copied!" : "Share Invite Link"}
              </button>
            )}
            {statusNum === 0 && showOpponentJoin && (
              <button
                className="w-full rounded-2xl border border-sky-500/40 bg-sky-500/20 p-3 font-bold uppercase tracking-wider text-sky-100 transition-all hover:bg-sky-500/30 disabled:opacity-20 disabled:cursor-not-allowed"
                onClick={handleJoinClick}
                disabled={isJoinActionPending || isTxActionPending || !canShowJoinCTA}
              >
                {isJoinActionPending
                  ? "Processing..."
                  : !isConnected
                    ? `Connect + Lock Stake`
                    : `Join + Lock Stake`}
              </button>
            )}
            {(statusNum === 2 || (statusNum === 3 && !awaitingAcceptOrDispute && !hasSubmittedOutcome)) && canSelectOutcome && canDeclare && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={submitWinClaim}
                  disabled={!canAct || !canDeclare || !address || txActionBusy}
                  className="rounded-2xl border border-sky-500/60 bg-sky-500/20 p-3 text-xs font-bold uppercase tracking-wider text-sky-100 disabled:opacity-20"
                >
                  I Won
                </button>
                <button
                  type="button"
                  onClick={() => setShowLoseConfirm(true)}
                  disabled={!canAct || !canDeclare || !opponentAddressForLoss || txActionBusy}
                  className="rounded-2xl border border-red-500/40 bg-red-500/15 p-3 text-xs font-bold uppercase tracking-wider text-red-100 disabled:opacity-20"
                >
                  I Lost
                </button>
              </div>
            )}
            {statusNum === 3 && awaitingAcceptOrDispute && normalizedProposedWinner && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded-2xl border border-emerald-500/40 bg-emerald-500/20 p-3 text-xs font-bold uppercase tracking-wider text-emerald-100 disabled:opacity-20"
                  disabled={!canAct || txActionBusy}
                  onClick={() =>
                    runTx("Accept opponent result", () =>
                      writeWithNonce({
                        address: escrowAddress!,
                        abi: escrowAbi,
                        functionName: "proposeWinner",
                        args: [matchId, normalizedProposedWinner] as const,
                      }),
                    )
                  }
                >
                  Confirm
                </button>
                <button
                  className="rounded-2xl border border-red-500/40 bg-red-500/20 p-3 text-xs font-bold uppercase tracking-wider text-red-100 disabled:opacity-20"
                  disabled={!canAct || disputeCooldownActive || isTxActionPending}
                  onClick={openDisputeConfirm}
                >
                  Dispute
                </button>
              </div>
            )}
            {statusNum === 4 && isPlayer && (
              <button
                type="button"
                className="w-full rounded-2xl border border-amber-500/40 bg-amber-500/20 p-3 text-xs font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-500/30"
                onClick={() => setActiveTab("chat")}
              >
                Open Chat
              </button>
            )}
            {statusNum === 5 && (
              <div className="text-center text-xs font-bold uppercase tracking-wider text-emerald-300">
                Resolved: {resolvedWinnerLabel}
              </div>
            )}
            {statusNum === 6 && (
              <div className="text-center text-xs font-bold uppercase tracking-wider text-red-300">
                Match Cancelled
              </div>
            )}
          </div>
        </div>

      </div>

      {showDisputePanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowDisputePanel(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-900/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.35em] text-amber-300/80">Dispute Center</div>
                <h3 className="mt-1 text-2xl font-semibold text-white">Match #{roomCode}</h3>
              </div>
              <button
                type="button"
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
                onClick={() => setShowDisputePanel(false)}
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-xs text-gray-300">
                Upload score screenshots or final game result evidence for admin review.
              </div>

              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-[10px] uppercase tracking-[0.35em] text-amber-300/80">
                  Dispute Policy Window
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-black/40 p-2">
                    Evidence upload priority: <span className="text-amber-200">{formatCountdown(evidenceWindowRemainingSec)}</span>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-2">
                    30m policy timeout: <span className="text-amber-200">{formatCountdown(policyWindowRemainingSec)}</span>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-amber-100/90">
                  Creator evidence: {creatorEvidenceCount} | Opponent evidence: {opponentEvidenceCount}
                </div>
                {policyWinnerLabel && (
                  <div className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-emerald-200">
                    30-minute policy condition met. Current winner by evidence policy: {policyWinnerLabel}.
                  </div>
                )}
              </div>

              {statusNum === 4 && (
                <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
                  <input
                    id="dispute-evidence-upload"
                    type="file"
                    accept="image/*"
                    onChange={(event) => void onEvidenceFileChange(event)}
                    className="sr-only"
                  />
                  <label
                    htmlFor="dispute-evidence-upload"
                    className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-sky-400/50 bg-sky-500/10 px-4 py-4 transition hover:bg-sky-500/15"
                  >
                    <div className="rounded-xl border border-sky-400/60 bg-sky-500/20 p-2 text-sky-100">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 16V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M7 9L12 4L17 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M5 20H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-sky-100">
                        Click Here To Upload Evidence
                      </div>
                      <div className="text-[11px] text-sky-200/90">Attachment only. Max file size: 5MB.</div>
                    </div>
                  </label>

                  {evidenceAttachment && (
                    <div className="mt-3 rounded-2xl border border-white/15 bg-slate-900/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-white">
                            {evidenceAttachment.name}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {formatFileSize(evidenceAttachment.sizeBytes)} | {evidenceAttachment.mimeType}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-200 hover:bg-white/10"
                          onClick={() => setEvidenceAttachment(null)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}

                  <textarea
                    value={evidenceNote}
                    onChange={(event) => setEvidenceNote(event.target.value)}
                    placeholder="Required note: include scoreline and what the screenshot proves"
                    className="mt-3 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-sky-500"
                    rows={3}
                  />
                  {evidenceError && <div className="mt-2 text-xs text-red-300">{evidenceError}</div>}
                  <button
                    type="button"
                    className="mt-3 rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-500/30 disabled:opacity-30"
                    onClick={() => void uploadDisputeEvidence()}
                    disabled={!isPlayer || !isConnected || !evidenceAttachment}
                  >
                    Upload Evidence
                  </button>
                  <button
                    type="button"
                    className="mt-3 rounded-xl border border-red-500/40 bg-red-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-red-100 hover:bg-red-500/30 disabled:opacity-30"
                    onClick={() => setShowConcedeDisputeConfirm(true)}
                    disabled={!isPlayer || !canAct}
                  >
                    I Lost - Cancel Dispute
                  </button>
                </div>
              )}

              <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
                <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.3em] text-gray-500">
                    <span>Dispute Chat</span>
                    <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[9px] text-sky-200">
                      Admin + Players
                    </span>
                  </div>
                  {disputeMessages.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-400">
                      No messages yet. Admin will post updates here.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {disputeMessages.map((message) => {
                        const isAdmin = message.senderRole === "admin";
                        const isPlayerMessage = message.senderRole === "player";
                        const isSelfPlayer =
                          isPlayerMessage &&
                          Boolean(address) &&
                          message.senderAddress.toLowerCase() === String(address).toLowerCase();
                        return (
                          <div
                            key={message.id}
                            className={`flex ${isAdmin || isSelfPlayer ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[88%] rounded-2xl border px-3 py-2 ${
                                isAdmin
                                  ? "border-sky-500/40 bg-sky-500/20 text-sky-100"
                                  : isPlayerMessage
                                    ? isSelfPlayer
                                      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-100"
                                      : "border-indigo-500/30 bg-indigo-500/10 text-indigo-100"
                                    : "border-amber-500/30 bg-amber-500/10 text-amber-100"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-white/70">
                                <span>
                                  {isAdmin
                                    ? "Admin"
                                    : isPlayerMessage
                                      ? isSelfPlayer
                                        ? "You"
                                        : `Player ${displayNameForWallet(message.senderAddress)}`
                                      : "System"}
                                </span>
                                <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                              </div>
                              <p className="mt-1 text-xs leading-relaxed">{message.message}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {statusNum === 4 && isPlayer && (
                    <div className="mt-3 border-t border-white/10 pt-3">
                      <textarea
                        value={disputeMessageDraft}
                        onChange={(event) => {
                          setDisputeMessageDraft(event.target.value);
                          if (disputeMessageError) setDisputeMessageError(null);
                        }}
                        placeholder="Send a dispute message to admin and opponent..."
                        rows={2}
                        className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white outline-none focus:border-sky-500"
                        disabled={!isConnected || isSendingDisputeMessage}
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-gray-500">
                          Social handles are automatically blocked for player messages.
                        </span>
                        <button
                          type="button"
                          className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-500/30 disabled:opacity-30"
                          onClick={() => void sendDisputeMessage()}
                          disabled={!canSendDisputeMessage}
                        >
                          {isSendingDisputeMessage ? "Sending..." : "Send Message"}
                        </button>
                      </div>
                      {disputeMessageError && (
                        <div className="mt-2 text-xs text-red-300">{disputeMessageError}</div>
                      )}
                    </div>
                  )}
                </div>
                {disputeEvidence.length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-xs text-gray-400">
                    No dispute evidence uploaded yet.
                  </div>
                )}
                {disputeEvidence.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-black/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-400">
                      <span>Uploader: {displayNameForWallet(item.uploader)}</span>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    {item.note && <p className="mt-2 text-xs text-gray-300">{item.note}</p>}
                    <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/70 p-3">
                      <div className="flex items-center justify-between gap-3">
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
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {isRematching && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-3xl border border-emerald-500/30 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl">
            <div className="text-[11px] uppercase tracking-[0.35em] text-emerald-300/80">Rematch</div>
            <h3 className="mt-2 text-2xl font-semibold text-white">Rematching Same Stake</h3>
            <p className="mt-2 text-sm text-gray-300">
              {rematchStatusText || "Preparing your rematch room..."}
            </p>
            <div className="mt-5 flex items-center gap-3 text-emerald-200">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-300/40 border-t-emerald-200" />
              <span className="text-xs uppercase tracking-wider">Processing</span>
            </div>
          </div>
        </div>
      )}

      {showAwaitingOpponent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowAwaitingOpponent(false)}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-sky-500/30 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-[11px] uppercase tracking-[0.35em] text-sky-300/80">Result Submitted</div>
            <h3 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Waiting For Opponent</h3>
            <p className="mt-3 text-sm text-gray-300">
              Your win was submitted on-chain. Opponent can accept now, dispute, or timeout will allow keeper bot
              to finalize and release payout against no-response.
            </p>
            {timeoutSecondsLeft !== null && (
              <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Keeper timeout: {timeoutSecondsLeft > 0 ? `${timeoutSecondsLeft}s remaining` : "ready now"}.
                {timeoutSecondsLeft <= 0
                  ? " Finalization in progress by keeper bot."
                  : " After timeout, non-responsive opponent loses claim and payout is released."}
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
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-red-500/30 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-[11px] uppercase tracking-[0.35em] text-red-300/80">Confirm Dispute</div>
            <h3 className="mt-2 text-2xl font-semibold text-white">Open dispute now?</h3>
            <p className="mt-3 text-sm text-gray-300">
              This sends the match to dispute state for admin resolution. You can upload evidence later in Dispute Center.
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
                disabled={!canAct || disputeCooldownActive || isTxActionPending}
                onClick={submitDispute}
              >
                {disputeCooldownActive
                  ? `Dispute Started Already (${disputeCooldownRemainingSec}s)`
                  : "Confirm Dispute"}
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
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
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
                disabled={!canAct || !canDeclare || !opponentAddressForLoss || txActionBusy}
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

      {showConcedeDisputeConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowConcedeDisputeConfirm(false)}
        >
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-red-500/30 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-[11px] uppercase tracking-[0.35em] text-red-300/80">Concede Dispute</div>
            <h3 className="mt-2 text-2xl font-semibold text-white">Confirm you lost this dispute?</h3>
            <p className="mt-3 text-sm text-gray-300">
              This closes dispute and releases escrow payout to your opponent.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
                onClick={() => setShowConcedeDisputeConfirm(false)}
              >
                Go Back
              </button>
              <button
                type="button"
                className="rounded-2xl border border-red-500/40 bg-red-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-red-100 hover:bg-red-500/30 disabled:opacity-20"
                disabled={!isPlayer || !canAct || isTxActionPending}
                onClick={submitConcedeDispute}
              >
                Confirm And Release
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
