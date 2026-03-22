"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import PageShell from "@/components/PageShell";
import GlassCard from "@/components/GlassCard";
import { Skeleton } from "@/components/Skeleton";

export default function VaultPage() {
  const { isConnected } = useAccount();
  const [showConnectPrompt, setShowConnectPrompt] = useState(false);
  const openConnectRef = useRef<(() => void) | null>(null);
  const systemOnline = Boolean(isConnected);

  /* ── Platform Stats ── */
  const [platformStats, setPlatformStats] = useState<{
    totalMatches: number;
    activePlayers: number;
    totalStaked: string;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetchStats() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const lbRes = await fetch("/api/leaderboards?chainId=420420417&page=1&limit=1", {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (lbRes.ok) {
          const lbData = await lbRes.json() as { total?: number };
          if (mounted) {
            setPlatformStats({
              totalMatches: (lbData.total ?? 0) * 3,
              activePlayers: lbData.total ?? 0,
              totalStaked: "Live",
            });
          }
        } else {
          if (mounted) setPlatformStats({ totalMatches: 0, activePlayers: 0, totalStaked: "—" });
        }
      } catch {
        if (mounted) setPlatformStats({ totalMatches: 0, activePlayers: 0, totalStaked: "—" });
      }
    }
    void fetchStats();
    return () => { mounted = false; };
  }, []);

  function handleCreateMatchClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (isConnected) return;
    event.preventDefault();
    setShowConnectPrompt(true);
  }

  return (
    <PageShell>
      <div className="animate-fade-in-up">
        {/* Hero Section */}
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          {/* Left: Hero */}
          <div className="lg:col-span-7 flex flex-col justify-center">
            <div
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-widest w-fit mb-6 ${
                systemOnline
                  ? "border border-sky-500/30 bg-sky-500/10 text-sky-400"
                  : "border border-gray-500/30 bg-gray-500/10 text-gray-300"
              }`}
            >
              <span className="relative flex h-2 w-2">
                {systemOnline ? (
                  <>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
                  </>
                ) : (
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-gray-400" />
                )}
              </span>
              {systemOnline ? "System Online" : "Connect Wallet"}
            </div>

            <h2 className="text-3xl font-black uppercase italic leading-none tracking-tighter text-white sm:text-5xl md:text-7xl">
              Dominate <br />
              <span className="animate-shimmer-text">
                The Arena
              </span>
            </h2>

            <p className="mt-6 max-w-lg text-base text-gray-400 leading-relaxed sm:text-lg">
              High-stakes 1v1 escrow protocol. Secure your funds, challenge opponents, and settle disputes on-chain.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Link
                href="/matches/create"
                className="btn-ripple btn-press group relative overflow-hidden rounded-lg border border-red-400/80 bg-red-600 p-4 transition-all hover:bg-red-500 hover:shadow-[0_0_30px_rgba(239,68,68,0.25)]"
                onClick={handleCreateMatchClick}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-400/40 bg-red-500/30">
                    <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 17.5L3 6V3h3l11.5 11.5" /><path d="M13 19l6-6" /><path d="M16 16l4 4" /><path d="M19 21l2-2" />
                      <path d="M9.5 6.5L21 18v3h-3L6.5 9.5" /><path d="M11 5L5 11" /><path d="M8 8L4 4" /><path d="M5 3L3 5" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-white sm:text-xl">Create Match</div>
                    <p className="text-xs text-red-100/80">Lock stake & share invite</p>
                  </div>
                </div>
              </Link>
              <Link
                href="/matches"
                className="btn-ripple btn-press group relative overflow-hidden rounded-lg border border-sky-500/30 bg-sky-500/10 p-4 transition-all hover:bg-sky-500/20 hover:shadow-[0_0_30px_rgba(56,189,248,0.15)]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/20">
                    <svg className="h-5 w-5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-white sm:text-xl">Join / Search</div>
                    <p className="text-xs text-sky-200/70">Enter room code to join</p>
                  </div>
                </div>
              </Link>
            </div>
          </div>

          {/* Right: Escrow Info + Stats */}
          <div className="lg:col-span-5 space-y-4">
            <GlassCard glow hover={false}>
              <div className="text-[11px] uppercase tracking-[0.35em] text-sky-400/80">Escrow Flow</div>
              <h3 className="mt-2 text-xl font-semibold text-white sm:text-2xl">No Vault Deposits</h3>
              <p className="mt-3 text-sm text-gray-400">
                Stakes lock directly in the match escrow. Creator locks stake on create, opponent locks on join.
              </p>
              <ul className="mt-5 space-y-2.5 text-xs text-gray-400 stagger-children">
                <li className="flex items-start gap-2.5">
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 text-[10px] font-bold text-sky-400">1</span>
                  Create match and lock your stake.
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 text-[10px] font-bold text-sky-400">2</span>
                  Opponent joins and locks the same stake.
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 text-[10px] font-bold text-sky-400">3</span>
                  Winner receives payout minus 2% platform fee.
                </li>
              </ul>
              <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-xs uppercase tracking-widest text-sky-300">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Escrow only — no deposits.
              </div>
            </GlassCard>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3 stagger-children">
              {platformStats ? (
                <>
                  <div className="card-hover rounded-xl border border-white/5 bg-slate-900/80 p-3 text-center">
                    <p className="text-xl font-black text-white">{platformStats.activePlayers}</p>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Players</p>
                  </div>
                  <div className="card-hover rounded-xl border border-white/5 bg-slate-900/80 p-3 text-center">
                    <p className="text-xl font-black text-white">{platformStats.totalMatches}</p>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Matches</p>
                  </div>
                  <div className="card-hover rounded-xl border border-white/5 bg-slate-900/80 p-3 text-center">
                    <p className="text-xl font-black text-sky-400">{platformStats.totalStaked}</p>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">On-Chain</p>
                  </div>
                </>
              ) : (
                <>
                  <Skeleton className="h-16 rounded-xl" />
                  <Skeleton className="h-16 rounded-xl" />
                  <Skeleton className="h-16 rounded-xl" />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Quick Access Cards */}
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
          <Link href="/tournaments" className="group card-hover block">
            <GlassCard>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 transition-colors group-hover:bg-amber-500/20">
                  <svg className="h-5 w-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-white group-hover:text-amber-400 transition-colors">Tournaments</p>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Compete for prizes</p>
                </div>
              </div>
            </GlassCard>
          </Link>

          <Link href="/leaderboards" className="group card-hover block">
            <GlassCard>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 transition-colors group-hover:bg-emerald-500/20">
                  <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">Leaderboards</p>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Top players</p>
                </div>
              </div>
            </GlassCard>
          </Link>

          <Link href="/profile" className="group card-hover block">
            <GlassCard>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10 transition-colors group-hover:bg-violet-500/20">
                  <svg className="h-5 w-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-white group-hover:text-violet-400 transition-colors">Your Profile</p>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Stats & referrals</p>
                </div>
              </div>
            </GlassCard>
          </Link>

          <Link href="/matches" className="group card-hover block">
            <GlassCard>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 transition-colors group-hover:bg-sky-500/20">
                  <svg className="h-5 w-5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-white group-hover:text-sky-400 transition-colors">Find Match</p>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Enter room code</p>
                </div>
              </div>
            </GlassCard>
          </Link>
        </div>
      </div>

      {showConnectPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => setShowConnectPrompt(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl animate-fade-in-up"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10">
                <svg className="h-5 w-5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.35em] text-sky-400/80">Wallet Required</div>
                <h3 className="text-lg font-semibold text-white">Connect to create a match</h3>
              </div>
            </div>
            <p className="mt-3 text-sm text-gray-400">
              You need a connected wallet before starting a new match escrow.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="btn-press rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
                onClick={() => setShowConnectPrompt(false)}
              >
                Not now
              </button>
              <ConnectButton.Custom>
                {({ openConnectModal }) => {
                  openConnectRef.current = openConnectModal;
                  return (
                    <button
                      type="button"
                      className="btn-press rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-500/30"
                      onClick={() => {
                        setShowConnectPrompt(false);
                        openConnectModal();
                      }}
                    >
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M22 10H2" /><path d="M6 14h.01" /></svg>
                        Connect Wallet
                      </span>
                    </button>
                  );
                }}
              </ConnectButton.Custom>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
