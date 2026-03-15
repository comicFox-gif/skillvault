"use client";

import Link from "next/link";
import { useMemo, useState, use } from "react";

const mockPlayers = [
  { name: "Alpha", points: 9, wins: 3, losses: 0 },
  { name: "Blitz", points: 6, wins: 2, losses: 1 },
  { name: "Cipher", points: 4, wins: 1, losses: 2 },
  { name: "Drift", points: 3, wins: 1, losses: 2 },
  { name: "Echo", points: 1, wins: 0, losses: 3 },
];

export default function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [selectedTab, setSelectedTab] = useState<"overview" | "standings" | "matches">("overview");

  const payout = useMemo(() => [70, 20, 10], []);

  return (
    <main
      className="relative min-h-screen w-full overflow-x-hidden bg-transparent text-white selection:bg-sky-500/30"
    >
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] h-[600px] w-[600px] rounded-full bg-sky-900/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full bg-slate-700/20 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Tournament #{id}</div>
            <h1 className="mt-2 text-2xl font-black uppercase tracking-tight sm:text-3xl">Night Circuit Cup</h1>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link className="border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider sm:text-sm" href="/tournaments">
              Back
            </Link>
            <Link className="border border-sky-500/30 bg-sky-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-sky-300 sm:text-sm" href="/">
              Home
            </Link>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 backdrop-blur-xl">
          <div className="flex flex-wrap gap-3">
            {([
              { key: "overview", label: "Overview" },
              { key: "standings", label: "Standings" },
              { key: "matches", label: "Matches" },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSelectedTab(tab.key)}
                className={`rounded-2xl border px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${
                  selectedTab === tab.key
                    ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
                    : "border-white/10 bg-black/40 text-gray-400 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {selectedTab === "overview" && (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Game</div>
                <div className="mt-2 text-lg">eFootball - Console</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Players</div>
                <div className="mt-2 text-lg">8 Participants</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Timeframe</div>
                <div className="mt-2 text-lg">10 mins per match</div>
              </div>

              <div className="sm:col-span-3 rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Payouts</div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  {payout.map((pct, idx) => (
                    <div key={pct} className="rounded-xl border border-white/10 bg-black/40 p-3">
                      <div className="text-[10px] uppercase tracking-widest text-gray-500">Pos {idx + 1}</div>
                      <div className="mt-1 text-sky-300 font-semibold">{pct}%</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {selectedTab === "standings" && (
            <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-black/60 text-xs uppercase tracking-widest text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Player</th>
                    <th className="px-4 py-3 text-center">Wins</th>
                    <th className="px-4 py-3 text-center">Losses</th>
                    <th className="px-4 py-3 text-center">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {mockPlayers.map((p, idx) => (
                    <tr key={p.name} className={idx % 2 === 0 ? "bg-black/40" : "bg-black/20"}>
                      <td className="px-4 py-3 font-semibold text-sky-200">{p.name}</td>
                      <td className="px-4 py-3 text-center">{p.wins}</td>
                      <td className="px-4 py-3 text-center">{p.losses}</td>
                      <td className="px-4 py-3 text-center text-sky-300">{p.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedTab === "matches" && (
            <div className="mt-6 space-y-3 text-sm text-gray-300">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                Round 1 - Alpha vs Echo - Result: 3-0
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                Round 1 - Blitz vs Drift - Result: 2-1
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                Round 1 - Cipher vs (BYE) - Auto-advance
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}





