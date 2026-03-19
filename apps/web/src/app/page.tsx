"use client";

import Link from "next/link";
import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect } from "wagmi";

export default function VaultPage() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [showConnectPrompt, setShowConnectPrompt] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement | null>(null);
  const openConnectRef = useRef<(() => void) | null>(null);
  const systemOnline = Boolean(isConnected);

  useEffect(() => {
    function onDocClick(event: globalThis.MouseEvent) {
      if (!walletMenuRef.current) return;
      if (walletMenuRef.current.contains(event.target as Node)) return;
      setWalletMenuOpen(false);
    }

    if (walletMenuOpen) {
      document.addEventListener("mousedown", onDocClick);
    }
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [walletMenuOpen]);

  function handleCreateMatchClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (isConnected) return;
    event.preventDefault();
    setShowConnectPrompt(true);
  }

  async function handleLinkWalletClick(openConnectModal: () => void) {
    try {
      const ethereum = (
        window as Window & {
          ethereum?: { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
        }
      ).ethereum;
      if (ethereum?.request) {
        try {
          // Force a fresh permission request path so MetaMask shows connect prompt again.
          await ethereum.request({
            method: "wallet_revokePermissions",
            params: [{ eth_accounts: {} }],
          });
        } catch {
          // Ignore unsupported or user-cancelled revoke; still open connector.
        }
      }
    } finally {
      openConnectModal();
    }
  }


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

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <header className="mb-10 border-b border-white/5 pb-6 sm:mb-12">
          <div className="flex w-full items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center border border-sky-500/30 bg-sky-500/10 [transform:skewX(-10deg)]">
                <span className="font-bold text-sky-400 [transform:skewX(10deg)]">SV</span>
              </div>
              <div>
                <h1 className="text-xl font-bold uppercase tracking-tighter text-white sm:text-2xl">
                  Skill <span className="text-sky-500">Vault</span>
                </h1>
              </div>
            </div>

            {!isConnected ? (
              <ConnectButton.Custom>
                {({ openConnectModal }) => {
                  openConnectRef.current = openConnectModal;
                  return (
                    <button
                      type="button"
                      onClick={() => void handleLinkWalletClick(openConnectModal)}
                      className="relative cursor-pointer overflow-hidden rounded-[3px] border border-sky-500/60 bg-transparent px-3 py-2 text-xs font-semibold uppercase text-sky-200 transition hover:bg-sky-500/10 sm:tracking-[0.2em]"
                    >
                      <span className="relative flex items-center gap-2">
                        <span className="inline-flex h-2 w-2 rounded-full bg-sky-400" />
                        <span className="sm:hidden">Connect</span>
                        <span className="hidden sm:inline">Link Wallet</span>
                      </span>
                    </button>
                  );
                }}
              </ConnectButton.Custom>
            ) : (
              <div className="relative" ref={walletMenuRef}>
                <button
                  type="button"
                  onClick={() => setWalletMenuOpen((open) => !open)}
                  className="relative overflow-hidden rounded-[3px] border border-sky-500/60 bg-transparent px-3 py-2 text-xs font-semibold uppercase text-sky-200 transition hover:bg-sky-500/10 sm:px-4 sm:tracking-[0.25em]"
                >
                  <span className="relative flex items-center gap-2">
                    <span className="inline-flex h-2 w-2 rounded-full bg-sky-400" />
                    {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Wallet"}
                    <span className="text-sky-400/70">v</span>
                  </span>
                </button>
                {walletMenuOpen && (
                  <div className="absolute right-0 mt-3 w-56 rounded-2xl border border-white/10 bg-slate-900/95 p-2 shadow-[0_30px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl z-50">
                    <div className="px-3 pb-2 text-[10px] uppercase tracking-[0.3em] text-gray-500">
                      Wallet Actions
                    </div>
                    <button
                      type="button"
                      className="w-full rounded-xl px-3 py-2 text-left text-xs uppercase tracking-widest text-gray-300 hover:bg-white/5"
                      onClick={() => {
                        if (address) {
                          navigator.clipboard?.writeText(address);
                        }
                        setWalletMenuOpen(false);
                      }}
                    >
                      <span className="flex items-center gap-2">
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
                        Copy Address
                      </span>
                    </button>
                    <button
                      type="button"
                      className="mt-1 w-full rounded-xl px-3 py-2 text-left text-xs uppercase tracking-widest text-red-300 hover:bg-red-500/10"
                      onClick={() => {
                        disconnect();
                        setWalletMenuOpen(false);
                      }}
                    >
                      <span className="flex items-center gap-2">
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
                          <path d="M10 17l5-5-5-5" />
                          <path d="M15 12H3" />
                          <path d="M21 12a9 9 0 0 0-9-9" />
                          <path d="M12 21a9 9 0 0 0 9-9" />
                        </svg>
                        Disconnect
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex w-full flex-wrap items-center gap-4">
            <Link
              href="/matches"
              className="text-xs font-bold uppercase tracking-wider text-gray-400 transition-colors hover:text-white sm:text-sm"
            >
              Matches
            </Link>
            <Link
              href="/tournaments"
              className="text-xs font-bold uppercase tracking-wider text-gray-400 transition-colors hover:text-white sm:text-sm"
            >
              Tournaments
            </Link>
            <Link
              href="/matches/create"
              className="rounded-md border border-red-400/70 bg-red-600 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-red-500 sm:text-sm"
              onClick={handleCreateMatchClick}
            >
              Create Match
            </Link>
          </div>
        </header>

        {/* Main Content Grid */}
        <div className="grid gap-10 lg:grid-cols-12">
          {/* Left: Hero */}
          <div className="lg:col-span-7 flex flex-col justify-center">
            <div
              className={`inline-flex items-center gap-2 rounded px-3 py-1 text-xs font-bold uppercase tracking-widest w-fit mb-6 ${
                systemOnline
                  ? "border border-sky-500/30 bg-sky-500/10 text-sky-400"
                  : "border border-gray-500/30 bg-gray-500/10 text-gray-300"
              }`}
            >
              <span className="relative flex h-2 w-2">
                {systemOnline ? (
                  <>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500"></span>
                  </>
                ) : (
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-gray-400"></span>
                )}
              </span>
              {systemOnline ? "System Online" : "System Offline"}
            </div>

            <h2 className="text-3xl font-black uppercase italic leading-none tracking-tighter text-white sm:text-5xl md:text-7xl">
              Dominate <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-sky-200">
                The Arena
              </span>
            </h2>

            <p className="mt-6 max-w-lg text-base text-gray-400 leading-relaxed sm:text-lg">
              High-stakes 1v1 escrow protocol. Secure your funds, challenge opponents, and settle disputes on-chain.
            </p>

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Link
                href="/matches/create"
                className="group border border-red-400/80 bg-red-600 p-4 backdrop-blur-sm transition-all hover:bg-red-500"
                onClick={handleCreateMatchClick}
              >
                <div className="mt-1 text-xl font-bold text-white sm:text-2xl">Create Match</div>
                <p className="mt-1 text-xs text-red-100/90">Lock stake and share invite link</p>
              </Link>
              <Link
                href="/matches"
                className="group border border-sky-500/30 bg-sky-500/10 p-4 backdrop-blur-sm transition-all hover:bg-sky-500/20"
              >
                <div className="mt-1 text-xl font-bold text-white sm:text-2xl">Join / Search Match</div>
                <p className="mt-1 text-xs text-sky-200/80">Enter room code and join your opponent</p>
              </Link>
            </div>
          </div>

          {/* Right: Action Panel */}
          <div className="lg:col-span-5">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(59,130,246,0.15),transparent_45%)]" />
              <div className="relative rounded-[22px] bg-slate-900/90 p-5 backdrop-blur-xl sm:p-7">
                <div className="text-[11px] uppercase tracking-[0.35em] text-sky-400/80">Escrow Flow</div>
                <h3 className="mt-2 text-xl font-semibold text-white sm:text-2xl">No Vault Deposits</h3>
                <p className="mt-3 text-sm text-gray-400">
                  Stakes lock directly in the match escrow. Creator locks stake on create, opponent locks on join.
                </p>
                <ul className="mt-6 space-y-3 text-xs text-gray-400">
                  <li>1) Create match and lock your stake.</li>
                  <li>2) Opponent joins and locks the same stake.</li>
                  <li>3) Winner receives payout minus 2% platform fee.</li>
                </ul>
                <div className="mt-6 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs uppercase tracking-widest text-sky-300">
                  Escrow only - no platform wallet deposits.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showConnectPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowConnectPrompt(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-[11px] uppercase tracking-[0.35em] text-sky-400/80">Wallet Required</div>
            <h3 className="mt-2 text-2xl font-semibold text-white">Connect to create a match</h3>
            <p className="mt-3 text-sm text-gray-400">
              You need a connected wallet before starting a new match escrow.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
                onClick={() => setShowConnectPrompt(false)}
              >
                Not now
              </button>
              <button
                type="button"
                className="rounded-2xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-xs font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-500/30"
                onClick={() => {
                  setShowConnectPrompt(false);
                  openConnectRef.current?.();
                }}
              >
                Connect Wallet
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}





