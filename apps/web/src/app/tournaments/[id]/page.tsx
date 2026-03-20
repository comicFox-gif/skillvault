"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog, formatEther, zeroAddress, type Address } from "viem";
import { getEscrowAddressForChain, getNativeSymbolForChain } from "@/lib/chains";
import { encodeMatchCode } from "@/lib/matchCode";
import {
  bootstrapTournamentRequest,
  deleteTournamentRequest,
  exitTournamentRequest,
  joinTournamentRequest,
  linkTournamentEscrowMatchRequest,
  loadTournament,
  type TournamentDetail,
  type TournamentMatch,
} from "@/lib/tournaments";
import { loadWalletProfile, loadWalletProfiles } from "@/lib/profile";
import { publishWalletNotification, showBrowserNotification } from "@/lib/notifications";

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function resultLabel(match: TournamentMatch) {
  if (match.result === "pending") return "Pending (On-chain sync)";
  if (match.result === "draw") return "Draw";
  if (match.result === "bye_home") return "Bye";
  if (match.result === "home_win") return `${match.homeUsername} won`;
  if (match.result === "away_win") return `${match.awayUsername ?? "Away"} won`;
  return match.result;
}

const ENTRY_JOIN_WINDOW_SECONDS = 7n * 24n * 60n * 60n;
const FIXTURE_JOIN_WINDOW_SECONDS = 30n * 60n;

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
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [],
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

export default function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [item, setItem] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [deletingTournament, setDeletingTournament] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [selectedTab, setSelectedTab] = useState<"overview" | "standings" | "matches">("overview");
  const [walletUsernames, setWalletUsernames] = useState<Record<string, string>>({});
  const [walletAvatars, setWalletAvatars] = useState<Record<string, string>>({});
  const [linkingMatchId, setLinkingMatchId] = useState<string | null>(null);
  const [creatingFixtureMatchId, setCreatingFixtureMatchId] = useState<string | null>(null);
  const [stakeTxState, setStakeTxState] = useState<"idle" | "signing" | "pending">("idle");
  const notificationStateRef = useRef<{
    status: TournamentDetail["status"];
    participantCount: number;
    recordedMatches: number;
  } | null>(null);

  const isJoined = useMemo(() => {
    if (!item || !address) return false;
    return item.entries.some((entry) => entry.wallet.toLowerCase() === address.toLowerCase());
  }, [address, item]);
  const isHost = useMemo(() => {
    if (!item || !address) return false;
    return item.createdByWallet.toLowerCase() === address.toLowerCase();
  }, [address, item]);
  const roleLabel = useMemo(() => {
    if (!item || !address) return "Spectator";
    const wallet = address.toLowerCase();
    if (item.createdByWallet.toLowerCase() === wallet) return "Host";
    if (item.entries.some((entry) => entry.wallet.toLowerCase() === wallet)) return "Participant";
    return "Spectator";
  }, [address, item]);
  const myEntry = useMemo(() => {
    if (!item || !address) return null;
    return item.entries.find((entry) => entry.wallet.toLowerCase() === address.toLowerCase()) ?? null;
  }, [address, item]);
  const hostEntry = useMemo(() => {
    if (!item) return null;
    return item.entries.find((entry) => entry.wallet.toLowerCase() === item.createdByWallet.toLowerCase()) ?? null;
  }, [item]);
  const isNotStarted = useMemo(() => {
    if (!item) return false;
    return item.status !== "in_progress" && item.status !== "completed" && item.matches.length === 0;
  }, [item]);
  const stakeSymbol = useMemo(() => getNativeSymbolForChain(item?.stakeChainId), [item?.stakeChainId]);
  const stakeDisplay = useMemo(() => {
    if (!item) return "0";
    try {
      return formatEther(BigInt(item.stakeWei));
    } catch {
      return "0";
    }
  }, [item]);
  const totalPoolDisplay = useMemo(() => {
    if (!item) return "0";
    try {
      const total = BigInt(item.stakeWei) * BigInt(item.participantCount);
      return formatEther(total);
    } catch {
      return "0";
    }
  }, [item]);
  const canDeleteTournament = useMemo(() => {
    if (!item) return false;
    return isHost && isNotStarted && item.entries.length === 1;
  }, [isHost, isNotStarted, item]);

  async function reloadTournament(showLoading = false) {
    try {
      if (showLoading) setLoading(true);
      setError("");
      const detail = await loadTournament(id);
      setItem(detail);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError, "Failed to load tournament."));
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void reloadTournament(true);
  }, [id]);

  useEffect(() => {
    if (!item) return;
    const intervalId = window.setInterval(() => {
      void reloadTournament(false);
    }, 8000);
    return () => window.clearInterval(intervalId);
  }, [item?.id]);

  useEffect(() => {
    if (!item) return;
    const wallets = Array.from(
      new Set(
        [item.createdByWallet, ...item.entries.map((entry) => entry.wallet)]
          .filter((wallet): wallet is string => Boolean(wallet))
          .map((wallet) => wallet.toLowerCase()),
      ),
    );
    if (!wallets.length) return;
    let mounted = true;
    async function run() {
      const profiles = await loadWalletProfiles(wallets);
      if (!mounted) return;
      const nextNames: Record<string, string> = {};
      const nextAvatars: Record<string, string> = {};
      for (const [wallet, profile] of Object.entries(profiles)) {
        const username = profile?.username?.trim();
        const avatar = profile?.avatarDataUrl?.trim();
        if (username) nextNames[wallet] = username;
        if (avatar) nextAvatars[wallet] = avatar;
      }
      setWalletUsernames((prev) => ({ ...prev, ...nextNames }));
      setWalletAvatars((prev) => ({ ...prev, ...nextAvatars }));
    }
    void run();
    return () => {
      mounted = false;
    };
  }, [item]);

  useEffect(() => {
    if (!item) return;
    if (item.status !== "full" || item.matches.length > 0) return;
    if (!isHost) return;
    const tournamentId = item.id;
    let mounted = true;
    async function run() {
      try {
        setBootstrapping(true);
        const updated = await bootstrapTournamentRequest(tournamentId);
        if (mounted) setItem(updated);
      } catch {
        // ignore auto-bootstrap errors
      } finally {
        if (mounted) setBootstrapping(false);
      }
    }
    void run();
    return () => {
      mounted = false;
    };
  }, [isHost, item]);

  useEffect(() => {
    if (!item) return;
    const current = {
      status: item.status,
      participantCount: item.participantCount,
      recordedMatches: item.matches.filter((match) => match.result !== "pending").length,
    };
    const previous = notificationStateRef.current;
    notificationStateRef.current = current;
    if (!previous) return;

    const tournamentPath = `/tournaments/${encodeURIComponent(item.id)}`;
    if (current.participantCount > previous.participantCount) {
      void showBrowserNotification("Tournament participant joined", {
        body: `${item.title}: ${current.participantCount}/${item.size} players joined.`,
        tag: `tournament-join-${item.id}`,
        url: tournamentPath,
      });
    }
    if (current.status !== previous.status) {
      if (current.status === "in_progress") {
        void showBrowserNotification("Tournament started", {
          body: `${item.title} is now live.`,
          tag: `tournament-started-${item.id}`,
          url: tournamentPath,
          requireInteraction: true,
        });
      } else if (current.status === "completed") {
        void showBrowserNotification("Tournament completed", {
          body: `${item.title} is complete. Final standings are available.`,
          tag: `tournament-completed-${item.id}`,
          url: tournamentPath,
          requireInteraction: true,
        });
      }
    }
  }, [item]);

  function displayName(wallet: string, fallback?: string) {
    return walletUsernames[wallet.toLowerCase()] || fallback || `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  }

  function avatarOf(wallet: string) {
    return walletAvatars[wallet.toLowerCase()] || "";
  }

  function extractMatchIdFromReceipt(receipt: any, escrowAddress: Address) {
    const escrowLower = escrowAddress.toLowerCase();
    for (const log of receipt.logs ?? []) {
      if (String(log.address ?? "").toLowerCase() !== escrowLower) continue;
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

  async function createEntryStakeLock() {
    if (!item || !address || !isConnected) throw new Error("Connect wallet first.");
    if (!publicClient) throw new Error("Wallet client is not ready.");
    if (chainId !== item.stakeChainId) {
      throw new Error(`Switch wallet network to chain #${item.stakeChainId} to lock stake.`);
    }
    const escrowAddress = getEscrowAddressForChain(chainId);
    if (!escrowAddress) throw new Error("Escrow address missing for this chain.");

    const stakeWei = BigInt(item.stakeWei);
    setStakeTxState("signing");
    const expected = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "nextMatchId",
      args: [],
    });
    const expectedId = typeof expected === "bigint" ? expected.toString() : null;

    const hash = await writeContractAsync({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "createMatch",
      args: [
        zeroAddress,
        stakeWei,
        ENTRY_JOIN_WINDOW_SECONDS,
        BigInt(Math.max(1, Number(item.timeframeMins || 10))) * 60n,
      ],
      value: stakeWei,
    });
    setStakeTxState("pending");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Stake lock transaction reverted.");
    const matchId = extractMatchIdFromReceipt(receipt, escrowAddress as Address) ?? expectedId;
    if (!matchId) throw new Error("Failed to resolve stake lock id.");
    return { matchId };
  }

  async function cancelEntryStakeLock(entryMatchId: string) {
    if (!item || !address || !isConnected) throw new Error("Connect wallet first.");
    if (!publicClient) throw new Error("Wallet client is not ready.");
    if (chainId !== item.stakeChainId) {
      throw new Error(`Switch wallet network to chain #${item.stakeChainId} to cancel stake.`);
    }
    const escrowAddress = getEscrowAddressForChain(chainId);
    if (!escrowAddress) throw new Error("Escrow address missing for this chain.");
    const hash = await writeContractAsync({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "cancel",
      args: [BigInt(entryMatchId)],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Stake refund transaction reverted.");
  }

  async function dispatchTournamentPushNotification(payload: {
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
      url: `/tournaments/${encodeURIComponent(id)}`,
      data: { tournamentId: id, ...payload.data },
    });
  }

  async function handleJoin() {
    if (!address || !isConnected || !item) {
      setActionMessage("Connect wallet to join.");
      return;
    }
    try {
      setJoining(true);
      setStakeTxState("idle");
      setActionMessage("");
      const profile = await loadWalletProfile(address);
      if (!profile?.username) {
        setActionMessage("Set your username in Profile before joining.");
        return;
      }
      setActionMessage(`Confirm stake lock in wallet (${stakeDisplay} ${stakeSymbol}).`);
      const lock = await createEntryStakeLock();
      const updated = await joinTournamentRequest(item.id, {
        wallet: address,
        username: profile.username,
        stakeEscrowMatchId: lock.matchId,
        stakeChainId: item.stakeChainId,
      });
      setItem(updated);
      setActionMessage("You joined this tournament.");
      void dispatchTournamentPushNotification({
        wallets: [updated.createdByWallet],
        title: "Player joined tournament",
        body: `${profile.username} joined ${updated.title}.`,
        tag: `tournament-player-joined-${updated.id}`,
      });
    } catch (joinError: unknown) {
      setActionMessage(
        getErrorMessage(
          joinError,
          "Failed to join tournament. If stake was locked but join failed, you can cancel your lock from this page.",
        ),
      );
    } finally {
      setStakeTxState("idle");
      setJoining(false);
    }
  }

  async function handleExitTournament() {
    if (!item || !address || !myEntry) return;
    if (!isNotStarted) {
      setActionMessage("Tournament already started. Exit is disabled.");
      return;
    }
    if (!myEntry.stakeEscrowMatchId) {
      setActionMessage("Missing stake lock ID for this entry.");
      return;
    }
    const accepted = window.confirm(
      `Exit tournament and refund ${stakeDisplay} ${stakeSymbol} to your wallet?`,
    );
    if (!accepted) return;
    try {
      setExiting(true);
      setStakeTxState("signing");
      setActionMessage("Confirm refund transaction in wallet...");
      await cancelEntryStakeLock(myEntry.stakeEscrowMatchId);
      const updated = await exitTournamentRequest(item.id, { wallet: address });
      setItem(updated);
      setActionMessage("You exited the tournament and your stake was refunded.");
    } catch (exitError: unknown) {
      setActionMessage(getErrorMessage(exitError, "Failed to exit tournament."));
    } finally {
      setStakeTxState("idle");
      setExiting(false);
    }
  }

  async function handleDeleteTournament() {
    if (!item || !address || !isHost) return;
    if (!canDeleteTournament) {
      setActionMessage("Delete requires no other joined players.");
      return;
    }
    if (!isNotStarted) {
      setActionMessage("Tournament already started. Delete is disabled.");
      return;
    }
    const entry = hostEntry;
    if (!entry?.stakeEscrowMatchId) {
      setActionMessage("Missing host stake lock ID.");
      return;
    }
    const accepted = window.confirm(
      `Delete tournament and refund ${stakeDisplay} ${stakeSymbol} host stake?`,
    );
    if (!accepted) return;
    try {
      setDeletingTournament(true);
      setStakeTxState("signing");
      setActionMessage("Confirm host refund transaction in wallet...");
      await cancelEntryStakeLock(entry.stakeEscrowMatchId);
      await deleteTournamentRequest(item.id, { wallet: address });
      router.push("/tournaments");
    } catch (deleteError: unknown) {
      setActionMessage(getErrorMessage(deleteError, "Failed to delete tournament."));
    } finally {
      setStakeTxState("idle");
      setDeletingTournament(false);
    }
  }

  async function createAndLinkEscrowFixture(match: TournamentMatch) {
    if (!item || !address || !isConnected) {
      setActionMessage("Connect wallet to create fixture escrow.");
      return;
    }
    if (!match.awayWallet) {
      setActionMessage("Bye fixtures do not need escrow rooms.");
      return;
    }
    const viewer = address.toLowerCase();
    const home = match.homeWallet.toLowerCase();
    const away = match.awayWallet.toLowerCase();
    if (viewer !== home && viewer !== away) {
      setActionMessage("Only matched players can create fixture escrow rooms.");
      return;
    }
    if (!publicClient) {
      setActionMessage("Wallet client not ready. Reconnect and try again.");
      return;
    }
    if (chainId !== item.stakeChainId) {
      setActionMessage(`Switch wallet network to chain #${item.stakeChainId}.`);
      return;
    }
    const escrowAddress = getEscrowAddressForChain(chainId);
    if (!escrowAddress) {
      setActionMessage("Escrow contract is not configured on this chain.");
      return;
    }

    const opponent = (viewer === home ? match.awayWallet : match.homeWallet) as Address;
    const stakeWei = BigInt(item.stakeWei);
    try {
      setCreatingFixtureMatchId(match.id);
      setActionMessage("Confirm fixture escrow creation in wallet...");
      const expected = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "nextMatchId",
        args: [],
      });
      const expectedMatchId = typeof expected === "bigint" ? expected.toString() : null;

      const hash = await writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "createMatch",
        args: [
          opponent,
          stakeWei,
          FIXTURE_JOIN_WINDOW_SECONDS,
          BigInt(Math.max(1, Number(item.timeframeMins || 10))) * 60n,
        ],
        value: stakeWei,
      });
      setActionMessage("Transaction submitted. Finalizing fixture room...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Fixture escrow transaction reverted.");
      }
      const escrowMatchId = extractMatchIdFromReceipt(receipt, escrowAddress as Address) ?? expectedMatchId;
      if (!escrowMatchId) {
        throw new Error("Unable to resolve new fixture room code.");
      }
      const roomCode = encodeMatchCode(escrowMatchId);

      setLinkingMatchId(match.id);
      const updated = await linkTournamentEscrowMatchRequest(item.id, match.id, {
        linkerWallet: address,
        chainId: item.stakeChainId,
        roomCode,
      });
      setItem(updated);
      setActionMessage(`Fixture escrow room ${roomCode} created and linked.`);
      void dispatchTournamentPushNotification({
        wallets: [match.homeWallet, match.awayWallet, updated.createdByWallet],
        title: "Tournament fixture ready",
        body: `${updated.title}: Fixture room ${roomCode} is ready. Opponent can join now.`,
        tag: `tournament-fixture-ready-${updated.id}-${match.id}`,
      });
    } catch (createError: unknown) {
      setActionMessage(getErrorMessage(createError, "Failed to create and link fixture escrow room."));
    } finally {
      setCreatingFixtureMatchId(null);
      setLinkingMatchId(null);
    }
  }

  if (loading) {
    return <main className="relative min-h-screen w-full overflow-x-hidden bg-transparent text-white"><div className="relative z-10 mx-auto max-w-6xl px-4 py-10">Loading tournament...</div></main>;
  }
  if (!item) {
    return <main className="relative min-h-screen w-full overflow-x-hidden bg-transparent text-white"><div className="relative z-10 mx-auto max-w-6xl px-4 py-10 text-red-300">{error || "Tournament not found."}</div></main>;
  }

  const champion = item.status === "completed" && item.entries.length > 0 ? item.entries[0] : null;

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-transparent text-white selection:bg-sky-500/30">
      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Tournament #{id}</div>
            <h1 className="mt-2 text-2xl font-black uppercase tracking-tight sm:text-3xl">{item.title}</h1>
            <div className="mt-2 text-sm text-gray-400">Role: <span className="text-sky-300">{roleLabel}</span> - {item.participantCount}/{item.size} players</div>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link className="border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider" href="/tournaments">Back</Link>
            <button type="button" onClick={() => void reloadTournament(false)} className="border border-sky-500/30 bg-sky-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-sky-300">Sync Now</button>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className="flex flex-col gap-3">
            <div className="text-sm text-gray-300">
              Status: <span className="font-semibold text-sky-300">{item.status.replace("_", " ")}</span> | Format:{" "}
              <span className="font-semibold text-sky-300">{item.format === "league" ? "League" : "Bracket"}</span>
              {item.format === "league" ? ` | Target: ${item.pointsTarget ?? 30} pts` : ""}
            </div>
            <div className="text-sm text-gray-300">
              Entry Stake: <span className="font-semibold text-sky-300">{stakeDisplay} {stakeSymbol}</span> | Est. Locked Pool:{" "}
              <span className="font-semibold text-sky-300">{totalPoolDisplay} {stakeSymbol}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleJoin()}
                disabled={joining || isJoined || item.status !== "open" || chainId !== item.stakeChainId}
                className="rounded-2xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-100 disabled:opacity-60"
              >
                {isJoined
                  ? "Joined"
                  : joining
                    ? stakeTxState === "signing"
                      ? "Confirm Lock..."
                      : stakeTxState === "pending"
                        ? "Locking..."
                        : "Joining..."
                    : item.status === "open"
                      ? `Join + Lock ${stakeDisplay} ${stakeSymbol}`
                      : "Locked"}
              </button>
              {isConnected && isJoined && !isHost && isNotStarted && (
                <button
                  type="button"
                  onClick={() => void handleExitTournament()}
                  disabled={exiting}
                  className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 disabled:opacity-60"
                >
                  {exiting ? "Exiting..." : "Exit + Refund Stake"}
                </button>
              )}
              {isConnected && isHost && isNotStarted && (
                <button
                  type="button"
                  onClick={() => void handleDeleteTournament()}
                  disabled={deletingTournament || !canDeleteTournament}
                  className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-red-100 disabled:opacity-60"
                >
                  {deletingTournament ? "Deleting..." : "Delete Tournament"}
                </button>
              )}
            </div>
            {chainId !== item.stakeChainId ? (
              <p className="text-xs text-amber-300">
                Switch wallet to chain #{item.stakeChainId} to lock/refund tournament stake.
              </p>
            ) : null}
            {isHost && isNotStarted && item.entries.length > 1 ? (
              <p className="text-xs text-amber-300">
                Delete is available only when no other players are joined.
              </p>
            ) : null}
          </div>
          {bootstrapping ? <p className="mt-2 text-xs text-gray-400">Generating tournament schedule...</p> : null}
          {champion ? <p className="mt-2 text-sm text-emerald-300">Champion: {displayName(champion.wallet, champion.username)} ({champion.points} pts)</p> : null}
          {actionMessage ? <p className="mt-2 text-sm text-gray-300">{actionMessage}</p> : null}
        </div>

        <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 backdrop-blur-xl">
          <div className="flex flex-wrap gap-3">
            {(["overview", "standings", "matches"] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setSelectedTab(tab)} className={`rounded-2xl border px-4 py-2 text-xs font-bold uppercase tracking-wider ${selectedTab === tab ? "border-sky-500/60 bg-sky-500/15 text-sky-200" : "border-white/10 bg-black/40 text-gray-400 hover:text-white"}`}>{tab}</button>
            ))}
          </div>

          {selectedTab === "overview" && (
            <div className="mt-6 grid gap-4 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4"><div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Game</div><div className="mt-2 text-lg">{item.game}</div></div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4"><div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Platform</div><div className="mt-2 text-lg">{item.platform}</div></div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4"><div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Players</div><div className="mt-2 text-lg">{item.participantCount}</div></div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4"><div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Matches Resolved</div><div className="mt-2 text-lg">{item.matches.filter((m) => m.result !== "pending").length}</div></div>
            </div>
          )}

          {selectedTab === "standings" && (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
              <table className="min-w-[820px] w-full text-sm">
                <thead className="bg-black/60 text-xs uppercase tracking-widest text-gray-500"><tr><th className="px-4 py-3 text-left">Player</th><th className="px-4 py-3 text-center">Stake</th><th className="px-4 py-3 text-center">P</th><th className="px-4 py-3 text-center">W</th><th className="px-4 py-3 text-center">D</th><th className="px-4 py-3 text-center">L</th><th className="px-4 py-3 text-center">PTS</th></tr></thead>
                <tbody>
                  {item.entries.map((entry, idx) => (
                    <tr key={entry.id} className={idx % 2 === 0 ? "bg-black/40" : "bg-black/20"}>
                      <td className="px-4 py-3 font-semibold text-sky-200"><div className="flex items-center gap-2">{avatarOf(entry.wallet) ? <img src={avatarOf(entry.wallet)} alt={entry.username} className="h-7 w-7 rounded-full border border-white/10 object-cover" /> : <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/40 text-[10px] text-sky-300">{(displayName(entry.wallet, entry.username).charAt(0) || "P").toUpperCase()}</span>}<span>{displayName(entry.wallet, entry.username)}</span></div></td>
                      <td className="px-4 py-3 text-center">{entry.stakeLocked ? "Locked" : "Open"}</td>
                      <td className="px-4 py-3 text-center">{entry.played}</td><td className="px-4 py-3 text-center">{entry.wins}</td><td className="px-4 py-3 text-center">{entry.draws}</td><td className="px-4 py-3 text-center">{entry.losses}</td><td className="px-4 py-3 text-center text-sky-300 font-semibold">{entry.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedTab === "matches" && (
            <div className="mt-6 space-y-3">
              {item.matches.length === 0 ? <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-gray-400">Match schedule not generated yet.</div> : sortMatches(item.matches).map((match) => {
                const pending = match.result === "pending";
                const viewer = address?.toLowerCase() ?? "";
                const isFixturePlayer = viewer && (viewer === match.homeWallet.toLowerCase() || viewer === String(match.awayWallet ?? "").toLowerCase());
                const canCreateEscrow = Boolean(isConnected && isFixturePlayer && chainId === item.stakeChainId);
                const fixtureRoomHref = match.escrowRoomCode
                  ? `/matches/${encodeURIComponent(match.escrowRoomCode)}?t=${encodeURIComponent(String(item.timeframeMins))}&g=${encodeURIComponent(item.game)}&p=${encodeURIComponent(item.platform)}&j=30`
                  : null;
                return (
                  <div key={match.id} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-gray-200">Round {match.roundNo}: <span className="text-sky-300">{displayName(match.homeWallet, match.homeUsername)}</span> vs <span className="text-sky-300">{match.awayWallet ? displayName(match.awayWallet, match.awayUsername ?? "") : "BYE"}</span></div>
                      <div className="text-xs text-gray-400">{resultLabel(match)}</div>
                    </div>
                    {!pending ? <div className="mt-2 text-xs text-gray-300">Auto Result: {match.homeScore ?? "-"} - {match.awayScore ?? "-"}</div> : null}
                    {pending && match.awayWallet && (
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
                        {match.escrowMatchId ? (
                          <div className="space-y-2">
                            <div className="text-xs text-sky-200">
                              Linked on chain #{match.escrowChainId} | Room {match.escrowRoomCode ?? "-"} | Match ID {match.escrowMatchId}.
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {fixtureRoomHref ? (
                                <Link
                                  href={fixtureRoomHref}
                                  className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-100"
                                >
                                  Open Match Room
                                </Link>
                              ) : null}
                              <span className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-gray-300">
                                Waiting for on-chain resolve...
                              </span>
                            </div>
                          </div>
                        ) : canCreateEscrow ? (
                          <div className="space-y-2">
                            <div className="text-xs text-gray-300">
                              Auto mode: create escrow room directly here. No manual room code linking needed.
                            </div>
                            <button
                              type="button"
                              onClick={() => void createAndLinkEscrowFixture(match)}
                              disabled={creatingFixtureMatchId === match.id || linkingMatchId === match.id}
                              className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-100 disabled:opacity-50"
                            >
                              {creatingFixtureMatchId === match.id
                                ? "Creating Escrow..."
                                : linkingMatchId === match.id
                                  ? "Linking..."
                                  : `Create Escrow Room (${stakeDisplay} ${stakeSymbol})`}
                            </button>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400">
                            {chainId !== item.stakeChainId
                              ? `Switch to chain #${item.stakeChainId} to create fixture escrow.`
                              : "Waiting for matched players to create escrow room."}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {item.format === "league" ? <p className="text-xs text-gray-400">League scoring is automatic from on-chain winner events: Win +3, Draw +1, Loss 0.</p> : <p className="text-xs text-gray-400">Bracket advancement is automatic after each linked match resolves on-chain.</p>}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function sortMatches(matches: TournamentMatch[]) {
  return [...matches].sort((a, b) => a.roundNo - b.roundNo || a.createdAt - b.createdAt);
}
