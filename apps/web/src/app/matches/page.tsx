"use client";

import Link from "next/link";
import { useState } from "react";

export default function MatchesPage() {
  const [id, setId] = useState("");

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

      <div className="relative z-10 mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:mb-12 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white sm:text-4xl">
            Active <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-sky-200">Matches</span>
          </h1>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link
              className="group relative flex items-center justify-center overflow-hidden border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-white/10 sm:text-sm"
              href="/"
            >
              Back
            </Link>
            <Link
              className="group relative flex items-center justify-center overflow-hidden border border-sky-500/30 bg-sky-500/10 px-6 py-2 text-xs font-bold uppercase tracking-wider text-sky-400 transition-all hover:bg-sky-500/20 sm:text-sm"
              href="/matches/create"
            >
              + Create Match
            </Link>
          </div>
        </div>

        <div className="grid gap-8">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(59,130,246,0.12),transparent_45%)]" />
            <div className="relative rounded-[22px] bg-slate-900/90 p-8 backdrop-blur-xl">
              <h3 className="mb-6 text-sm font-bold uppercase tracking-widest text-gray-500">Find Match by Room Code</h3>
              
              <div className="flex flex-col gap-4 sm:flex-row">
                <input
                  className="w-full border border-white/10 bg-black/50 p-4 text-base font-bold text-white placeholder-gray-700 outline-none transition-all focus:border-sky-500 sm:text-lg"
                  placeholder="Enter Room Code (e.g. 100245)"
                  value={id}
                  onChange={(e) => setId(e.target.value.replace(/\D/g, ""))}
                />
                <Link
                  className="flex items-center justify-center bg-white px-8 py-3 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-gray-200 sm:py-0 sm:text-sm"
                  href={`/matches/${encodeURIComponent(id || "100000")}`}
                >
                  Open
                </Link>
              </div>

              <div className="mt-8 flex items-start gap-3 border-t border-white/5 pt-6">
                <div className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-400">System Status</p>
                  <p className="mt-1 text-sm text-gray-600">
                    Manual ID entry required. Indexer module offline.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}





