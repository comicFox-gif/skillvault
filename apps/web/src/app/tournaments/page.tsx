"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { getNativeSymbolForChain } from "@/lib/chains";
import { loadTournaments, type TournamentSummary } from "@/lib/tournaments";
import PageShell from "@/components/PageShell";
import GlassCard from "@/components/GlassCard";
import { CardSkeleton } from "@/components/Skeleton";

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function formatStatus(status: TournamentSummary["status"]) {
  if (status === "full") return "Full";
  if (status === "in_progress") return "In Progress";
  if (status === "completed") return "Completed";
  return "Open";
}

const statusColors: Record<string, string> = {
  open: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  full: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  in_progress: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  completed: "border-gray-500/30 bg-gray-500/10 text-gray-300",
};

function stakeLabel(stakeWei: string, chainId: number) {
  try {
    return `${formatEther(BigInt(stakeWei))} ${getNativeSymbolForChain(chainId)}`;
  } catch {
    return `0 ${getNativeSymbolForChain(chainId)}`;
  }
}

export default function TournamentsPage() {
  const { address } = useAccount();
  const [items, setItems] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    async function run() {
      try {
        setLoading(true);
        setError("");
        const next = await loadTournaments(40);
        if (isMounted) setItems(next);
      } catch (fetchError: unknown) {
        if (isMounted) setError(getErrorMessage(fetchError, "Failed to load tournaments."));
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    void run();
    return () => {
      isMounted = false;
    };
  }, []);

  /* Pin user's tournaments to the top */
  const sortedItems = (() => {
    if (!address) return items;
    const wallet = address.toLowerCase();
    const mine: TournamentSummary[] = [];
    const rest: TournamentSummary[] = [];
    for (const t of items) {
      if (t.createdByWallet?.toLowerCase() === wallet) {
        mine.push(t);
      } else {
        rest.push(t);
      }
    }
    return [...mine, ...rest];
  })();

  function isUserInTournament(t: TournamentSummary) {
    if (!address) return false;
    const wallet = address.toLowerCase();
    return t.createdByWallet?.toLowerCase() === wallet;
  }

  return (
    <PageShell maxWidth="max-w-5xl">
      <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:mb-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">
            Tournaments
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            Bracketed competitions with 6-10 players. Payouts: 70% / 20% / 10%.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link className="border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider sm:text-sm" href="/">
            Back
          </Link>
          <Link className="border border-sky-500/30 bg-sky-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-sky-300 sm:text-sm" href="/tournaments/create">
            + Create Tournament
          </Link>
        </div>
      </div>

      {loading && (
        <div className="grid gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading && error && (
        <GlassCard hover={false}>
          <p className="text-sm text-red-200">{error}</p>
        </GlassCard>
      )}

      {!loading && !error && items.length === 0 && (
        <GlassCard hover={false}>
          <p className="text-sm text-gray-300">No tournaments yet. Create the first one.</p>
        </GlassCard>
      )}

      {!loading && !error && sortedItems.length > 0 && (
        <div className="grid gap-4">
          {sortedItems.map((t, idx) => {
            const userIn = isUserInTournament(t);
            return (
              <div
                key={t.id}
                className="animate-fade-in-up"
                style={{ animationDelay: `${idx * 60}ms`, animationFillMode: "both" }}
              >
                <GlassCard hover glow={userIn}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      {userIn && (
                        <span className="mb-2 inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                          You&apos;re in this
                        </span>
                      )}
                      <div className="text-xs uppercase tracking-[0.3em] text-gray-500">{t.game} - {t.platform}</div>
                      <h2 className="mt-2 text-2xl font-semibold text-white">{t.title}</h2>
                      <div className="mt-2 text-sm text-gray-400">
                        {t.participantCount}/{t.size} players - {t.timeframeMins} mins - Host: {t.createdByUsername}
                      </div>
                      <div className="mt-1 text-xs text-gray-400">
                        Entry stake: {stakeLabel(t.stakeWei, t.stakeChainId)}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {t.format === "league"
                          ? `League to ${t.pointsTarget ?? 30} points`
                          : "Bracket knockout"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider ${statusColors[t.status] ?? statusColors.open}`}>
                        {formatStatus(t.status)}
                      </span>
                      <Link
                        className="rounded-[3px] border border-sky-500/60 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-200 hover:bg-sky-500/10"
                        href={`/tournaments/${t.id}`}
                      >
                        View
                      </Link>
                    </div>
                  </div>
                </GlassCard>
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
