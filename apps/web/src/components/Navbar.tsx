"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect } from "wagmi";
import { loadWalletProfile } from "@/lib/profile";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/matches", label: "Matches", icon: SwordsIcon },
  { href: "/tournaments", label: "Tourneys", icon: TrophyIcon },
  { href: "/leaderboards", label: "Rankings", icon: ChartIcon },
  { href: "/profile", label: "Profile", icon: UserIcon, authOnly: true },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [walletUsername, setWalletUsername] = useState("");
  const walletMenuRef = useRef<HTMLDivElement | null>(null);
  const openConnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let mounted = true;
    async function run() {
      if (!isConnected || !address) {
        if (mounted) setWalletUsername("");
        return;
      }
      try {
        const profile = await loadWalletProfile(address);
        if (!mounted) return;
        setWalletUsername(profile?.username?.trim() ?? "");
      } catch {
        if (mounted) setWalletUsername("");
      }
    }
    void run();
    return () => { mounted = false; };
  }, [address, isConnected]);

  useEffect(() => {
    function onDocClick(event: globalThis.MouseEvent) {
      if (!walletMenuRef.current) return;
      if (walletMenuRef.current.contains(event.target as Node)) return;
      setWalletMenuOpen(false);
    }
    if (walletMenuOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [walletMenuOpen]);

  async function handleLinkWalletClick(openConnectModal: () => void) {
    try {
      const ethereum = (window as Window & { ethereum?: { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (ethereum?.request) {
        try { await ethereum.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); } catch {}
      }
    } finally {
      openConnectModal();
    }
  }

  const isMatchRoom = /^\/matches\/[^/]+$/.test(pathname) && pathname !== "/matches/create";

  const filteredItems = NAV_ITEMS.filter((item) => {
    if (item.authOnly && !isConnected) return false;
    return true;
  });

  return (
    <>
      {/* Desktop top navbar */}
      <nav className="sticky top-0 z-40 border-b border-white/5 bg-[var(--sv-bg)]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center border border-sky-500/30 bg-sky-500/10 [transform:skewX(-10deg)]">
              <span className="font-bold text-sky-400 text-sm [transform:skewX(10deg)]">SV</span>
            </div>
            <span className="text-lg font-bold uppercase tracking-tighter text-white hidden sm:block">
              Skill <span className="text-sky-500">Vault</span>
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1">
            {filteredItems.map((item) => {
              const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition-colors rounded-lg ${
                    isActive
                      ? "text-sky-400 bg-sky-500/10"
                      : "text-gray-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-sky-400" />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Wallet button */}
          <div className="flex items-center gap-3">
            {!isConnected ? (
              <ConnectButton.Custom>
                {({ openConnectModal }) => {
                  openConnectRef.current = openConnectModal;
                  return (
                    <button
                      type="button"
                      onClick={() => void handleLinkWalletClick(openConnectModal)}
                      className="relative overflow-hidden rounded-lg border border-sky-500/60 bg-transparent px-3 py-2 text-xs font-semibold uppercase text-sky-200 transition hover:bg-sky-500/10 sm:tracking-[0.15em]"
                    >
                      <span className="flex items-center gap-2">
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
                  onClick={() => setWalletMenuOpen((o) => !o)}
                  className="relative overflow-hidden rounded-lg border border-sky-500/60 bg-transparent px-3 py-2 text-xs font-semibold uppercase text-sky-200 transition hover:bg-sky-500/10 sm:tracking-[0.15em]"
                >
                  <span className="flex items-center gap-2">
                    <span className="inline-flex h-2 w-2 rounded-full bg-sky-400" />
                    {walletUsername || (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Wallet")}
                    <svg className="h-3 w-3 text-sky-400/70" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5l3 3 3-3" /></svg>
                  </span>
                </button>
                {walletMenuOpen && (
                  <div className="absolute right-0 mt-2 w-52 rounded-xl border border-white/10 bg-slate-900/95 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-xl z-50">
                    <div className="px-3 pb-1.5 pt-1 text-[10px] uppercase tracking-[0.3em] text-gray-500">
                      Wallet
                    </div>
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-xs uppercase tracking-widest text-gray-300 hover:bg-white/5"
                      onClick={() => { if (address) navigator.clipboard?.writeText(address); setWalletMenuOpen(false); }}
                    >
                      <span className="flex items-center gap-2">
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        Copy Address
                      </span>
                    </button>
                    <Link
                      href="/profile"
                      className="block w-full rounded-lg px-3 py-2 text-left text-xs uppercase tracking-widest text-gray-300 hover:bg-white/5"
                      onClick={() => setWalletMenuOpen(false)}
                    >
                      <span className="flex items-center gap-2">
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                        Profile
                      </span>
                    </Link>
                    <button
                      type="button"
                      className="mt-0.5 w-full rounded-lg px-3 py-2 text-left text-xs uppercase tracking-widest text-red-300 hover:bg-red-500/10"
                      onClick={() => { disconnect(); setWalletMenuOpen(false); }}
                    >
                      <span className="flex items-center gap-2">
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 12a9 9 0 0 0-9-9" /><path d="M12 21a9 9 0 0 0 9-9" /></svg>
                        Disconnect
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar - hidden in match rooms to avoid overlap with sticky actions */}
      {!isMatchRoom && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/5 bg-[var(--sv-bg)]/90 backdrop-blur-xl md:hidden safe-area-bottom">
          <div className="flex items-center justify-around px-2 py-1.5">
            {filteredItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 transition-colors ${
                    isActive ? "text-sky-400" : "text-gray-500"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/* ── Icon components ── */

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function SwordsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
      <path d="M9.5 6.5L21 18v3h-3L6.5 9.5" />
      <path d="M11 5L5 11" />
      <path d="M8 8L4 4" />
      <path d="M5 3L3 5" />
    </svg>
  );
}

function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
