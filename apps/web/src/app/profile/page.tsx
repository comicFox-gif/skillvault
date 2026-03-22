"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { supportedChainConfigs } from "@/lib/chains";
import { loadWalletProfile, saveWalletProfile } from "@/lib/profile";
import PageShell from "@/components/PageShell";
import GlassCard from "@/components/GlassCard";
import { useToast } from "@/components/Toast";
import { StatSkeleton } from "@/components/Skeleton";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read image."));
    };
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

async function loadImage(dataUrl: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to parse avatar image."));
    image.src = dataUrl;
  });
}

async function compressAvatar(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Avatar must be an image.");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("Avatar too large. Keep it below 2MB.");
  const sourceDataUrl = await fileToDataUrl(file);
  if (typeof window === "undefined") return sourceDataUrl;
  const image = await loadImage(sourceDataUrl);
  const maxSize = 320;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return sourceDataUrl;
  ctx.drawImage(image, 0, 0, width, height);
  const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!compressed) return sourceDataUrl;
  return await fileToDataUrl(new File([compressed], "avatar.jpg", { type: "image/jpeg" }));
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function run() {
      if (!isConnected || !address) {
        if (!mounted) return;
        setUsername(""); setAvatarDataUrl("");
        return;
      }
      try {
        setLoading(true);
        const profile = await loadWalletProfile(address);
        if (!mounted) return;
        setUsername(profile?.username ?? "");
        setAvatarDataUrl(profile?.avatarDataUrl ?? "");
      } catch {
        if (!mounted) return;
        toast("Failed to load profile.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void run();
    return () => { mounted = false; };
  }, [address, isConnected]);

  const initials = useMemo(() => {
    const text = username.trim();
    if (!text) return "SV";
    return text.split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
  }, [username]);

  /* ── Match Stats state ── */
  const walletChainId = useChainId();
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const activeChainId = selectedChainId ?? walletChainId;
  const [stats, setStats] = useState<{ wins: number; losses: number; disputes: number } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  /* ── Referral state ── */
  const [referralCode, setReferralCode] = useState("");
  const [referralCount, setReferralCount] = useState(0);
  const [referralLoading, setReferralLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function fetchStats() {
      if (!isConnected || !address) { setStats(null); return; }
      try {
        setStatsLoading(true);
        const res = await fetch(`/api/reputation?chainId=${activeChainId}&wallets=${address}`);
        if (!res.ok) throw new Error("Failed to fetch stats");
        const data = await res.json() as { items: Record<string, { wins: number; losses: number; disputes: number }> };
        if (!mounted) return;
        const entry = data.items[address] ?? data.items[address.toLowerCase()] ?? { wins: 0, losses: 0, disputes: 0 };
        setStats({ wins: entry.wins, losses: entry.losses, disputes: entry.disputes });
      } catch {
        if (mounted) setStats(null);
      } finally {
        if (mounted) setStatsLoading(false);
      }
    }
    void fetchStats();
    return () => { mounted = false; };
  }, [address, isConnected, activeChainId]);

  useEffect(() => {
    let mounted = true;
    async function fetchReferrals() {
      if (!isConnected || !address) { setReferralCode(""); setReferralCount(0); return; }
      try {
        setReferralLoading(true);
        const res = await fetch(`/api/referrals?wallet=${address}`);
        if (!res.ok) throw new Error();
        const data = await res.json() as { referrals: unknown[]; referralCode: string };
        if (!mounted) return;
        setReferralCode(data.referralCode ?? "");
        setReferralCount(Array.isArray(data.referrals) ? data.referrals.length : 0);
      } catch {
        if (mounted) { setReferralCode(""); setReferralCount(0); }
      } finally {
        if (mounted) setReferralLoading(false);
      }
    }
    void fetchReferrals();
    return () => { mounted = false; };
  }, [address, isConnected]);

  const winRate = stats && (stats.wins + stats.losses) > 0
    ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
    : 0;

  function copyReferralLink() {
    if (!referralCode) return;
    const link = `${window.location.origin}/matches/create?ref=${referralCode}`;
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      toast("Referral link copied!", "success");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function onAvatarPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressAvatar(file);
      setAvatarDataUrl(compressed);
    } catch (error: unknown) {
      toast(getErrorMessage(error, "Failed to set avatar."), "error");
    } finally {
      event.target.value = "";
    }
  }

  async function onSave() {
    if (!isConnected || !address) {
      toast("Connect wallet first.", "error");
      return;
    }
    try {
      setSaving(true);
      const profile = await saveWalletProfile(address, { username, avatarDataUrl });
      setUsername(profile.username ?? "");
      setAvatarDataUrl(profile.avatarDataUrl ?? "");
      toast("Profile saved.", "success");
    } catch (error: unknown) {
      toast(getErrorMessage(error, "Failed to save profile."), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell maxWidth="max-w-5xl">
      <div className="animate-fade-in-up">
        <h1 className="mb-8 text-2xl font-black uppercase tracking-tight sm:text-3xl">
          Player <span className="text-sky-400">Profile</span>
        </h1>

        {!isConnected ? (
          <GlassCard hover={false}>
            <p className="text-sm text-gray-300">Connect wallet to manage your profile.</p>
            <div className="mt-4">
              <ConnectButton />
            </div>
          </GlassCard>
        ) : (
          <div className="space-y-6">
            {/* Profile Header Card */}
            <GlassCard glow hover={false}>
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                {/* Avatar */}
                <div className="shrink-0 space-y-3">
                  <div className="mx-auto flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                    {avatarDataUrl ? (
                      <img src={avatarDataUrl} alt="Avatar" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-2xl font-bold text-sky-300">{initials}</span>
                    )}
                  </div>
                  <label className="block">
                    <input type="file" accept="image/*" className="sr-only" onChange={(event) => void onAvatarPick(event)} />
                    <span className="block rounded-lg border border-sky-500/40 bg-sky-500/20 px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-500/30 transition-colors">
                      Change Avatar
                    </span>
                  </label>
                </div>

                {/* Profile Form */}
                <div className="flex-1 space-y-4 w-full">
                  <div>
                    <label className="mb-1.5 block text-[10px] uppercase tracking-[0.3em] text-gray-500">Username</label>
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      maxLength={24}
                      placeholder={loading ? "Loading..." : "Set your username"}
                      className="w-full rounded-lg border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500 transition-colors"
                    />
                    <p className="mt-1.5 text-[10px] text-gray-500">
                      Appears in matches, disputes and tournaments.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] uppercase tracking-[0.3em] text-gray-500">Wallet</label>
                    <p className="rounded-lg border border-white/5 bg-black/30 px-4 py-3 text-xs text-gray-400 font-mono break-all">
                      {address}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onSave()}
                    disabled={saving || loading}
                    className="rounded-lg border border-sky-500/40 bg-sky-500/20 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-sky-100 disabled:opacity-60 hover:bg-sky-500/30 transition-colors"
                  >
                    {saving ? (
                      <span className="flex items-center gap-2">
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        Saving...
                      </span>
                    ) : "Save Profile"}
                  </button>
                </div>
              </div>
            </GlassCard>

            {/* Stats + Referrals Grid */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Match Stats */}
              <GlassCard hover={false}>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
                    <div className="h-1 w-4 bg-sky-500 rounded-full" />
                    Match Stats
                  </h2>
                  <select
                    value={activeChainId}
                    onChange={(e) => setSelectedChainId(Number(e.target.value))}
                    className="rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-[10px] text-white outline-none focus:border-sky-500"
                  >
                    {supportedChainConfigs.map((chain) => (
                      <option key={chain.id} value={chain.id}>{chain.name}</option>
                    ))}
                  </select>
                </div>

                {statsLoading ? (
                  <div className="grid grid-cols-3 gap-3">
                    <StatSkeleton /><StatSkeleton /><StatSkeleton />
                  </div>
                ) : stats ? (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-center animate-count-up">
                        <p className="text-2xl font-black text-emerald-300">{stats.wins}</p>
                        <p className="text-[10px] uppercase tracking-wider text-emerald-400/70">Wins</p>
                      </div>
                      <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-center animate-count-up" style={{ animationDelay: "0.1s" }}>
                        <p className="text-2xl font-black text-red-300">{stats.losses}</p>
                        <p className="text-[10px] uppercase tracking-wider text-red-400/70">Losses</p>
                      </div>
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-center animate-count-up" style={{ animationDelay: "0.2s" }}>
                        <p className="text-2xl font-black text-amber-300">{stats.disputes}</p>
                        <p className="text-[10px] uppercase tracking-wider text-amber-400/70">Disputes</p>
                      </div>
                    </div>
                    {/* Win rate bar */}
                    <div className="mt-4">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400">Win Rate</span>
                        <span className="text-xs font-bold text-emerald-300">{winRate}%</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                          style={{ width: `${winRate}%` }}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">No match history yet.</p>
                )}
              </GlassCard>

              {/* Referrals */}
              <GlassCard hover={false}>
                <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
                  <div className="h-1 w-4 bg-sky-500 rounded-full" />
                  Referrals
                </h2>

                {referralLoading ? (
                  <div className="space-y-3">
                    <StatSkeleton />
                  </div>
                ) : referralCode ? (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-[10px] uppercase tracking-[0.3em] text-gray-500">Your Referral Code</label>
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg border border-white/10 bg-black/50 px-4 py-2.5 text-sm font-mono text-white tracking-widest">
                          {referralCode}
                        </span>
                        <button
                          type="button"
                          onClick={copyReferralLink}
                          className="rounded-lg border border-sky-500/40 bg-sky-500/20 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-sky-100 hover:bg-sky-500/30 transition-colors"
                        >
                          {copied ? "Copied!" : "Copy Link"}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 rounded-xl border border-sky-500/20 bg-sky-500/10 p-4">
                      <div className="text-center">
                        <p className="text-2xl font-black text-sky-300">{referralCount}</p>
                        <p className="text-[10px] uppercase tracking-wider text-sky-400/70">Referred</p>
                      </div>
                      <div className="flex-1 text-xs text-gray-400">
                        Share your referral link with friends. When they create or join matches, you both benefit.
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No referral code available.</p>
                )}
              </GlassCard>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
