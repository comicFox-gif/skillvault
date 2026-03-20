"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { loadWalletProfile, saveWalletProfile } from "@/lib/profile";

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
  if (!file.type.startsWith("image/")) {
    throw new Error("Avatar must be an image.");
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error("Avatar too large. Keep it below 2MB.");
  }
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

  const compressed = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });
  if (!compressed) return sourceDataUrl;
  return await fileToDataUrl(new File([compressed], "avatar.jpg", { type: "image/jpeg" }));
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const [username, setUsername] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function run() {
      if (!isConnected || !address) {
        if (!mounted) return;
        setUsername("");
        setAvatarDataUrl("");
        setMessage("");
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
        setMessage("Failed to load profile.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void run();
    return () => {
      mounted = false;
    };
  }, [address, isConnected]);

  const initials = useMemo(() => {
    const text = username.trim();
    if (!text) return "SV";
    return text
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }, [username]);

  async function onAvatarPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setMessage("");
      const compressed = await compressAvatar(file);
      setAvatarDataUrl(compressed);
    } catch (error: unknown) {
      setMessage(getErrorMessage(error, "Failed to set avatar."));
    } finally {
      event.target.value = "";
    }
  }

  async function onSave() {
    if (!isConnected || !address) {
      setMessage("Connect wallet first.");
      return;
    }
    try {
      setSaving(true);
      setMessage("");
      const profile = await saveWalletProfile(address, {
        username,
        avatarDataUrl,
      });
      setUsername(profile.username ?? "");
      setAvatarDataUrl(profile.avatarDataUrl ?? "");
      setMessage("Profile saved.");
    } catch (error: unknown) {
      setMessage(getErrorMessage(error, "Failed to save profile."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-transparent text-white selection:bg-sky-500/30">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] h-[600px] w-[600px] rounded-full bg-sky-900/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full bg-slate-700/20 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-black uppercase tracking-tight sm:text-3xl">
            Player <span className="text-sky-400">Profile</span>
          </h1>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link className="border border-white/10 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-wider sm:text-sm" href="/">
              Home
            </Link>
            <Link className="border border-sky-500/30 bg-sky-500/10 px-5 py-2 text-xs font-bold uppercase tracking-wider text-sky-300 sm:text-sm" href="/matches">
              Matches
            </Link>
          </div>
        </div>

        {!isConnected ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 backdrop-blur-xl">
            <p className="text-sm text-gray-300">Connect wallet to manage your profile.</p>
            <div className="mt-4">
              <ConnectButton />
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 backdrop-blur-xl">
            <div className="grid gap-6 sm:grid-cols-[180px_1fr]">
              <div className="space-y-3">
                <div className="mx-auto flex h-36 w-36 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-black/40">
                  {avatarDataUrl ? (
                    <img src={avatarDataUrl} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-2xl font-bold text-sky-300">{initials}</span>
                  )}
                </div>
                <label className="block">
                  <input type="file" accept="image/*" className="sr-only" onChange={(event) => void onAvatarPick(event)} />
                  <span className="block rounded-2xl border border-sky-500/40 bg-sky-500/20 px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-sky-100">
                    Change Avatar
                  </span>
                </label>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-gray-500">Username</label>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    maxLength={24}
                    placeholder={loading ? "Loading..." : "Set your username"}
                    className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-sky-500"
                  />
                  <p className="mt-2 text-xs text-gray-400">
                    This username appears in matches, disputes and tournaments.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onSave()}
                  disabled={saving || loading}
                  className="rounded-2xl border border-sky-500/40 bg-sky-500/20 px-5 py-3 text-xs font-bold uppercase tracking-wider text-sky-100 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save Profile"}
                </button>
                {message ? <p className="text-sm text-sky-200">{message}</p> : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
