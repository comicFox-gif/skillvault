export type WalletProfile = {
  wallet: string;
  username: string;
  avatarDataUrl: string;
  updatedAt: number;
};

type ApiResponse = { profile?: WalletProfile | null; error?: string };
const profileCache = new Map<string, WalletProfile | null>();

function normalizeWallet(wallet: string) {
  return String(wallet ?? "").trim().toLowerCase();
}

export async function loadWalletProfile(wallet: string): Promise<WalletProfile | null> {
  const normalizedWallet = normalizeWallet(wallet);
  if (!normalizedWallet) return null;
  if (profileCache.has(normalizedWallet)) {
    return profileCache.get(normalizedWallet) ?? null;
  }
  const response = await fetch(`/api/users/${encodeURIComponent(normalizedWallet)}`, {
    method: "GET",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load username.");
  }
  const profile = payload.profile ?? null;
  profileCache.set(normalizedWallet, profile);
  return profile;
}

export async function saveWalletUsername(wallet: string, username: string): Promise<WalletProfile> {
  return saveWalletProfile(wallet, { username });
}

export async function saveWalletProfile(
  wallet: string,
  profilePayload: {
    username?: string;
    avatarDataUrl?: string;
  },
): Promise<WalletProfile> {
  const normalizedWallet = normalizeWallet(wallet);
  const response = await fetch(`/api/users/${encodeURIComponent(normalizedWallet)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profilePayload),
  });
  const responseBody = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok || !responseBody.profile) {
    throw new Error(responseBody.error || "Failed to save profile.");
  }
  profileCache.set(normalizedWallet, responseBody.profile);
  return responseBody.profile;
}

export async function loadWalletProfiles(wallets: string[]) {
  const unique = Array.from(
    new Set(wallets.map((wallet) => normalizeWallet(wallet)).filter((wallet) => /^0x[a-f0-9]{40}$/.test(wallet))),
  );
  const entries = await Promise.all(
    unique.map(async (wallet) => {
      try {
        const profile = await loadWalletProfile(wallet);
        return [wallet, profile] as const;
      } catch {
        return [wallet, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<string, WalletProfile | null>;
}
