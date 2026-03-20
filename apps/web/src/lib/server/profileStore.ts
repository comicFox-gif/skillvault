import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDatabaseSchema, getDatabase, isDatabaseConfigured } from "@/lib/server/db";

export type WalletProfile = {
  wallet: string;
  username: string;
  avatarDataUrl: string;
  updatedAt: number;
};

type ProfileStore = {
  byWallet: Record<string, WalletProfile>;
};

const SERVERLESS_RUNTIME = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const STORE_DIR = SERVERLESS_RUNTIME ? path.join(os.tmpdir(), "skillvault-data") : path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "wallet-profiles.json");

function normalizeWallet(walletRaw: string) {
  return String(walletRaw ?? "").trim().toLowerCase();
}

function toEpoch(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function sanitizeUsername(usernameRaw: string) {
  return String(usernameRaw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function validateWallet(wallet: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new Error("Invalid wallet address.");
  }
}

function validateUsername(username: string) {
  if (!username) return;
  if (username.length < 3 || username.length > 24) {
    throw new Error("Username must be 3-24 characters.");
  }
  if (!/^[a-zA-Z0-9 _-]+$/.test(username)) {
    throw new Error("Username can only use letters, numbers, space, _ and -.");
  }
}

function sanitizeAvatarDataUrl(valueRaw: string) {
  const value = String(valueRaw ?? "").trim();
  if (!value) return "";
  if (!value.startsWith("data:image/")) {
    throw new Error("Avatar must be an image.");
  }
  const maxChars = 2_800_000;
  if (value.length > maxChars) {
    throw new Error("Avatar is too large. Compress and upload again.");
  }
  return value;
}

function isRecoverableBackendError(error: unknown) {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  const lower = message.toLowerCase();
  return (
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("epipe") ||
    lower.includes("erofs") ||
    lower.includes("read-only file system") ||
    lower.includes("permission denied") ||
    lower.includes("database_url is not configured")
  );
}

function mapRow(row: Record<string, unknown>): WalletProfile {
  return {
    wallet: String(row.wallet ?? "").toLowerCase(),
    username: String(row.username ?? ""),
    avatarDataUrl: String(row.avatar_data_url ?? ""),
    updatedAt: toEpoch(row.updated_at),
  };
}

async function ensureStoreFile() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const empty: ProfileStore = { byWallet: {} };
    await fs.writeFile(STORE_PATH, JSON.stringify(empty, null, 2), "utf8");
  }
}

async function readStore(): Promise<ProfileStore> {
  await ensureStoreFile();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProfileStore>;
    return { byWallet: parsed.byWallet ?? {} };
  } catch {
    return { byWallet: {} };
  }
}

async function writeStore(store: ProfileStore) {
  await ensureStoreFile();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

async function getFromDatabase(wallet: string): Promise<WalletProfile | null> {
  await ensureDatabaseSchema();
  const db = getDatabase();
  const rows = await db`
    SELECT wallet, username, avatar_data_url, updated_at
    FROM wallet_profiles
    WHERE wallet = ${wallet}
    LIMIT 1
  `;
  if (!rows.length) return null;
  return mapRow(rows[0] as Record<string, unknown>);
}

async function upsertToDatabase(profile: WalletProfile) {
  await ensureDatabaseSchema();
  const db = getDatabase();
  await db`
    INSERT INTO wallet_profiles (wallet, username, avatar_data_url, updated_at)
    VALUES (${profile.wallet}, ${profile.username}, ${profile.avatarDataUrl || null}, ${profile.updatedAt})
    ON CONFLICT (wallet)
    DO UPDATE SET
      username = EXCLUDED.username,
      avatar_data_url = EXCLUDED.avatar_data_url,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function getWalletProfile(walletRaw: string): Promise<WalletProfile | null> {
  const wallet = normalizeWallet(walletRaw);
  if (!wallet) return null;
  validateWallet(wallet);

  if (isDatabaseConfigured()) {
    try {
      return await getFromDatabase(wallet);
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  return store.byWallet[wallet] ?? null;
}

export async function setWalletProfile(
  walletRaw: string,
  payload: { username?: string; avatarDataUrl?: string },
): Promise<WalletProfile> {
  const wallet = normalizeWallet(walletRaw);
  const username = sanitizeUsername(payload.username ?? "");
  const avatarDataUrl = sanitizeAvatarDataUrl(payload.avatarDataUrl ?? "");
  validateWallet(wallet);
  validateUsername(username);

  const existing = await getWalletProfile(wallet);
  const resolvedUsername = username || existing?.username || "";
  validateUsername(resolvedUsername);

  if (!resolvedUsername) {
    throw new Error("Set a username first.");
  }

  const profile: WalletProfile = {
    wallet,
    username: resolvedUsername,
    avatarDataUrl: avatarDataUrl || existing?.avatarDataUrl || "",
    updatedAt: Date.now(),
  };

  if (isDatabaseConfigured()) {
    try {
      await upsertToDatabase(profile);
      return profile;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  store.byWallet[wallet] = profile;
  await writeStore(store);
  return profile;
}

export async function setWalletProfileUsername(walletRaw: string, usernameRaw: string): Promise<WalletProfile> {
  return setWalletProfile(walletRaw, { username: usernameRaw });
}
