"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { supportedChainConfigs } from "@/lib/chains";
import PageShell from "@/components/PageShell";
import GlassCard from "@/components/GlassCard";
import { CardSkeleton } from "@/components/Skeleton";

const PAGE_SIZE = 50;

type Player = {
  wallet: string;
  username: string | null;
  avatarDataUrl: string | null;
  wins: number;
  losses: number;
  disputes: number;
  rank: number;
};

function shortAddress(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function winRate(wins: number, losses: number) {
  const total = wins + losses;
  if (total === 0) return 0;
  return Math.round((wins / total) * 100);
}

function rankBadge(rank: number) {
  if (rank === 1) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/40";
  if (rank === 2) return "bg-gray-400/20 text-gray-200 border-gray-400/40";
  if (rank === 3) return "bg-amber-700/20 text-amber-400 border-amber-700/40";
  return "bg-white/5 text-gray-400 border-white/10";
}

function rankLabel(rank: number) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `#${rank}`;
}

function rankSize(rank: number) {
  if (rank === 1) return "h-11 w-14 text-sm";
  if (rank === 2) return "h-10 w-13 text-sm";
  if (rank === 3) return "h-10 w-13 text-sm";
  return "h-8 w-10 text-xs";
}

function rankEmoji(rank: number) {
  if (rank === 1) return "\u{1F451}";
  if (rank === 2) return "\u{1F948}";
  if (rank === 3) return "\u{1F949}";
  return null;
}

export default function LeaderboardsPage() {
  const [chainId, setChainId] = useState(supportedChainConfigs[0]?.id ?? 0);
  const [players, setPlayers] = useState<Player[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const fetchLeaderboard = useCallback(async (cid: number, off: number) => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`/api/leaderboards?chainId=${cid}&limit=${PAGE_SIZE}&offset=${off}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setPlayers(data.players ?? []);
      setTotal(data.total ?? 0);
    } catch (err: any) {
      setError(err?.message || "Failed to load leaderboard.");
      setPlayers([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLeaderboard(chainId, offset);
  }, [chainId, offset, fetchLeaderboard]);

  function onChainChange(newChainId: number) {
    setChainId(newChainId);
    setOffset(0);
  }

  const filteredPlayers = useMemo(() => {
    if (!search.trim()) return players;
    const q = search.trim().toLowerCase();
    return players.filter(
      (p) =>
        (p.username && p.username.toLowerCase().includes(q)) ||
        p.wallet.toLowerCase().includes(q),
    );
  }, [players, search]);

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageShell maxWidth="max-w-4xl">
      <div className="animate-fade-in-up">
        {/* Header */}
        <div className="mb-8 border-b border-white/10 pb-6">
          <h1 className="text-2xl font-black uppercase tracking-tight sm:text-3xl">
            Leader<span className="text-sky-400">boards</span>
          </h1>
        </div>

        {/* Chain selector + search */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 sm:max-w-[16rem]">
            <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Network</label>
            <select
              value={chainId}
              onChange={(e) => onChainChange(Number(e.target.value))}
              className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
            >
              {supportedChainConfigs.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 sm:max-w-[20rem]">
            <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Search Player</label>
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or address..."
                className="w-full rounded-2xl border border-white/10 bg-black/50 py-3 pl-10 pr-4 text-sm text-white placeholder-gray-600 outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <GlassCard hover={false}>
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => void fetchLeaderboard(chainId, offset)}
              className="mt-4 rounded-2xl border border-sky-500/40 bg-sky-500/20 px-5 py-2 text-xs font-bold uppercase tracking-wider text-sky-100"
            >
              Retry
            </button>
          </GlassCard>
        )}

        {/* Empty state */}
        {!loading && !error && players.length === 0 && (
          <GlassCard hover={false}>
            <p className="text-center text-sm text-gray-400">No players found on this network yet.</p>
          </GlassCard>
        )}

        {/* No search results */}
        {!loading && !error && players.length > 0 && filteredPlayers.length === 0 && (
          <GlassCard hover={false}>
            <p className="text-center text-sm text-gray-400">
              No players matching &ldquo;{search}&rdquo;
            </p>
          </GlassCard>
        )}

        {/* Table view (md+) */}
        {!loading && !error && filteredPlayers.length > 0 && (
          <>
            <div className="hidden md:block">
              <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/90 backdrop-blur-xl">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Rank</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Player</th>
                      <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-gray-500">Wins</th>
                      <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-gray-500">Losses</th>
                      <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-gray-500">Disputes</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlayers.map((player) => {
                      const wr = winRate(player.wins, player.losses);
                      const isTop3 = player.rank <= 3;
                      return (
                        <tr
                          key={player.wallet}
                          className={`border-b border-white/5 last:border-b-0 transition-colors hover:bg-white/5 ${isTop3 ? "bg-white/[0.02]" : ""}`}
                        >
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center justify-center rounded-xl border font-bold ${rankSize(player.rank)} ${rankBadge(player.rank)}`}>
                              {rankEmoji(player.rank) ? (
                                <span className="mr-0.5">{rankEmoji(player.rank)}</span>
                              ) : null}
                              {rankLabel(player.rank)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                                {player.avatarDataUrl ? (
                                  <img src={player.avatarDataUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-xs font-bold text-sky-300">
                                    {(player.username || player.wallet).slice(0, 2).toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">
                                  {player.username || shortAddress(player.wallet)}
                                </p>
                                {player.username && (
                                  <p className="truncate text-xs text-gray-500">{shortAddress(player.wallet)}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-emerald-400">
                            <span className="animate-count-up">{player.wins}</span>
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-red-400">
                            <span className="animate-count-up">{player.losses}</span>
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-amber-400">
                            <span className="animate-count-up">{player.disputes}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-full max-w-[100px] overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-400"
                                  style={{ width: `${wr}%` }}
                                />
                              </div>
                              <span className="animate-count-up text-xs font-semibold text-gray-300">{wr}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Card view (mobile) */}
            <div className="flex flex-col gap-3 md:hidden">
              {filteredPlayers.map((player) => {
                const wr = winRate(player.wins, player.losses);
                const isTop3 = player.rank <= 3;
                return (
                  <GlassCard key={player.wallet} glow={isTop3} hover>
                    <div className="mb-3 flex items-center gap-3">
                      <span className={`inline-flex items-center justify-center rounded-xl border font-bold ${rankSize(player.rank)} ${rankBadge(player.rank)}`}>
                        {rankEmoji(player.rank) ? (
                          <span className="mr-0.5">{rankEmoji(player.rank)}</span>
                        ) : null}
                        {rankLabel(player.rank)}
                      </span>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                        {player.avatarDataUrl ? (
                          <img src={player.avatarDataUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xs font-bold text-sky-300">
                            {(player.username || player.wallet).slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">
                          {player.username || shortAddress(player.wallet)}
                        </p>
                        {player.username && (
                          <p className="truncate text-xs text-gray-500">{shortAddress(player.wallet)}</p>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      <div className="rounded-xl border border-white/5 bg-black/30 px-2 py-2">
                        <p className="animate-count-up font-semibold text-emerald-400">{player.wins}</p>
                        <p className="text-gray-500">Wins</p>
                      </div>
                      <div className="rounded-xl border border-white/5 bg-black/30 px-2 py-2">
                        <p className="animate-count-up font-semibold text-red-400">{player.losses}</p>
                        <p className="text-gray-500">Losses</p>
                      </div>
                      <div className="rounded-xl border border-white/5 bg-black/30 px-2 py-2">
                        <p className="animate-count-up font-semibold text-amber-400">{player.disputes}</p>
                        <p className="text-gray-500">Disputes</p>
                      </div>
                      <div className="rounded-xl border border-white/5 bg-black/30 px-2 py-2">
                        <p className="animate-count-up font-semibold text-sky-400">{wr}%</p>
                        <p className="text-gray-500">Win Rate</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-400"
                          style={{ width: `${wr}%` }}
                        />
                      </div>
                      <span className="animate-count-up text-xs font-semibold text-gray-300">{wr}%</span>
                    </div>
                  </GlassCard>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-30"
                >
                  Prev
                </button>
                <span className="text-xs text-gray-400">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
