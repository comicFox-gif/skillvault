"use client";

import Link from "next/link";

const mockTournaments = [
  {
    id: "12",
    title: "Night Circuit Cup",
    game: "eFootball",
    platform: "Console",
    size: 8,
    timeframe: "10 mins",
    status: "Open",
    startsAt: "Tonight 20:00",
  },
  {
    id: "15",
    title: "Final Clash",
    game: "Mortal Kombat",
    platform: "PC",
    size: 6,
    timeframe: "8 mins",
    status: "In Progress",
    startsAt: "Live",
  },
  {
    id: "21",
    title: "Road to Glory",
    game: "FC25",
    platform: "Console",
    size: 10,
    timeframe: "12 mins",
    status: "Open",
    startsAt: "Tomorrow 18:00",
  },
];

export default function TournamentsPage() {
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
        <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:mb-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">
              Tournaments <span className="text-sky-400">(Mock)</span>
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

        <div className="grid gap-4">
          {mockTournaments.map((t) => (
            <div
              key={t.id}
              className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 backdrop-blur-xl"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.3em] text-gray-500">{t.game} - {t.platform}</div>
                  <h2 className="mt-2 text-2xl font-semibold text-white">{t.title}</h2>
                  <div className="mt-2 text-sm text-gray-400">
                    {t.size} players - {t.timeframe} - {t.startsAt}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs uppercase tracking-wider text-sky-300">
                    {t.status}
                  </span>
                  <Link
                    className="rounded-[3px] border border-sky-500/60 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-200 hover:bg-sky-500/10"
                    href={`/tournaments/${t.id}`}
                  >
                    View
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}





