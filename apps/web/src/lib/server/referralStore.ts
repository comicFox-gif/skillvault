import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDatabase, isDatabaseConfigured } from "@/lib/server/db";

export type Referral = {
  id: string;
  referrerWallet: string;
  referredWallet?: string;
  referralCode: string;
  matchesCreated: number;
  matchesJoined: number;
  createdAt: number;
  claimedAt?: number;
};

type Store = {
  byId: Record<string, Referral>;
  byCode: Record<string, string>; // code -> id
  byWallet: Record<string, string[]>; // wallet -> id[]
};

const SERVERLESS_RUNTIME = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const STORE_DIR = SERVERLESS_RUNTIME ? path.join(os.tmpdir(), "skillvault-data") : path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "referrals.json");

let referralSchemaInitPromise: Promise<void> | null = null;

function normalizeAddress(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function toEpoch(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
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

function generateId() {
  return `ref_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function mapRow(row: Record<string, unknown>): Referral {
  return {
    id: String(row.id ?? ""),
    referrerWallet: String(row.referrer_wallet ?? "").toLowerCase(),
    referredWallet: row.referred_wallet ? String(row.referred_wallet).toLowerCase() : undefined,
    referralCode: String(row.referral_code ?? ""),
    matchesCreated: Number(row.matches_created ?? 0),
    matchesJoined: Number(row.matches_joined ?? 0),
    createdAt: toEpoch(row.created_at),
    claimedAt: row.claimed_at != null ? toEpoch(row.claimed_at) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Schema                                                            */
/* ------------------------------------------------------------------ */

async function ensureReferralSchema() {
  if (!isDatabaseConfigured()) return;
  if (referralSchemaInitPromise) {
    await referralSchemaInitPromise;
    return;
  }
  referralSchemaInitPromise = (async () => {
    const db = getDatabase();
    await db`
      CREATE TABLE IF NOT EXISTS referrals (
        id TEXT PRIMARY KEY,
        referrer_wallet TEXT NOT NULL,
        referred_wallet TEXT,
        referral_code TEXT UNIQUE NOT NULL,
        matches_created INTEGER NOT NULL DEFAULT 0,
        matches_joined INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        claimed_at BIGINT
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS referrals_referrer_wallet_idx
      ON referrals (referrer_wallet)
    `;
    await db`
      CREATE INDEX IF NOT EXISTS referrals_referral_code_idx
      ON referrals (referral_code)
    `;
  })();
  await referralSchemaInitPromise;
}

/* ------------------------------------------------------------------ */
/*  JSON file fallback                                                */
/* ------------------------------------------------------------------ */

async function ensureStoreFile() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const empty: Store = { byId: {}, byCode: {}, byWallet: {} };
    await fs.writeFile(STORE_PATH, JSON.stringify(empty, null, 2), "utf8");
  }
}

async function readStore(): Promise<Store> {
  await ensureStoreFile();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      byId: parsed.byId ?? {},
      byCode: parsed.byCode ?? {},
      byWallet: parsed.byWallet ?? {},
    };
  } catch {
    return { byId: {}, byCode: {}, byWallet: {} };
  }
}

async function writeStore(store: Store) {
  await ensureStoreFile();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

/* ------------------------------------------------------------------ */
/*  Database helpers                                                  */
/* ------------------------------------------------------------------ */

async function getByCodeFromDatabase(code: string): Promise<Referral | null> {
  await ensureReferralSchema();
  const db = getDatabase();
  const rows = await db`
    SELECT id, referrer_wallet, referred_wallet, referral_code,
           matches_created, matches_joined, created_at, claimed_at
    FROM referrals
    WHERE referral_code = ${code}
    LIMIT 1
  `;
  if (!rows.length) return null;
  return mapRow(rows[0] as Record<string, unknown>);
}

async function getByWalletFromDatabase(wallet: string): Promise<Referral[]> {
  await ensureReferralSchema();
  const db = getDatabase();
  const rows = await db`
    SELECT id, referrer_wallet, referred_wallet, referral_code,
           matches_created, matches_joined, created_at, claimed_at
    FROM referrals
    WHERE referrer_wallet = ${wallet}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => mapRow(r as Record<string, unknown>));
}

async function insertToDatabase(referral: Referral) {
  await ensureReferralSchema();
  const db = getDatabase();
  await db`
    INSERT INTO referrals (
      id, referrer_wallet, referred_wallet, referral_code,
      matches_created, matches_joined, created_at, claimed_at
    ) VALUES (
      ${referral.id},
      ${referral.referrerWallet},
      ${referral.referredWallet ?? null},
      ${referral.referralCode},
      ${referral.matchesCreated},
      ${referral.matchesJoined},
      ${referral.createdAt},
      ${referral.claimedAt ?? null}
    )
  `;
}

async function updateInDatabase(referral: Referral) {
  await ensureReferralSchema();
  const db = getDatabase();
  await db`
    UPDATE referrals
    SET referred_wallet = ${referral.referredWallet ?? null},
        matches_created = ${referral.matchesCreated},
        matches_joined = ${referral.matchesJoined},
        claimed_at = ${referral.claimedAt ?? null}
    WHERE id = ${referral.id}
  `;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export async function generateReferralCode(
  walletRaw: string,
): Promise<{ code: string; id: string }> {
  const wallet = normalizeAddress(walletRaw);
  if (!wallet) throw new Error("Invalid wallet address.");

  const id = generateId();
  const code = generateCode();
  const now = Date.now();

  const referral: Referral = {
    id,
    referrerWallet: wallet,
    referralCode: code,
    matchesCreated: 0,
    matchesJoined: 0,
    createdAt: now,
  };

  if (isDatabaseConfigured()) {
    try {
      await insertToDatabase(referral);
      return { code, id };
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  store.byId[id] = referral;
  store.byCode[code] = id;
  const walletIds = store.byWallet[wallet] ?? [];
  walletIds.push(id);
  store.byWallet[wallet] = walletIds;
  await writeStore(store);
  return { code, id };
}

export async function getReferralByCode(code: string): Promise<Referral | null> {
  const trimmedCode = String(code ?? "").trim().toUpperCase();
  if (!trimmedCode) return null;

  if (isDatabaseConfigured()) {
    try {
      return await getByCodeFromDatabase(trimmedCode);
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  const id = store.byCode[trimmedCode];
  if (!id) return null;
  return store.byId[id] ?? null;
}

export async function getReferralsByWallet(walletRaw: string): Promise<Referral[]> {
  const wallet = normalizeAddress(walletRaw);
  if (!wallet) return [];

  if (isDatabaseConfigured()) {
    try {
      return await getByWalletFromDatabase(wallet);
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  const ids = store.byWallet[wallet] ?? [];
  return ids
    .map((id) => store.byId[id])
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function claimReferral(
  code: string,
  referredWalletRaw: string,
): Promise<Referral | null> {
  const trimmedCode = String(code ?? "").trim().toUpperCase();
  const referredWallet = normalizeAddress(referredWalletRaw);
  if (!trimmedCode || !referredWallet) return null;

  if (isDatabaseConfigured()) {
    try {
      const existing = await getByCodeFromDatabase(trimmedCode);
      if (!existing) return null;
      if (existing.claimedAt) return null; // already claimed
      if (existing.referrerWallet === referredWallet) return null; // can't self-refer

      existing.referredWallet = referredWallet;
      existing.claimedAt = Date.now();
      await updateInDatabase(existing);
      return existing;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  const id = store.byCode[trimmedCode];
  if (!id) return null;
  const referral = store.byId[id];
  if (!referral) return null;
  if (referral.claimedAt) return null; // already claimed
  if (referral.referrerWallet === referredWallet) return null; // can't self-refer

  referral.referredWallet = referredWallet;
  referral.claimedAt = Date.now();
  store.byId[id] = referral;
  await writeStore(store);
  return referral;
}

export async function incrementReferralStat(
  referrerWalletRaw: string,
  stat: "matches_created" | "matches_joined",
): Promise<void> {
  const wallet = normalizeAddress(referrerWalletRaw);
  if (!wallet) return;

  if (isDatabaseConfigured()) {
    try {
      await ensureReferralSchema();
      const db = getDatabase();
      if (stat === "matches_created") {
        await db`
          UPDATE referrals
          SET matches_created = matches_created + 1
          WHERE referrer_wallet = ${wallet}
            AND claimed_at IS NOT NULL
        `;
      } else {
        await db`
          UPDATE referrals
          SET matches_joined = matches_joined + 1
          WHERE referrer_wallet = ${wallet}
            AND claimed_at IS NOT NULL
        `;
      }
      return;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  const ids = store.byWallet[wallet] ?? [];
  for (const id of ids) {
    const referral = store.byId[id];
    if (!referral || !referral.claimedAt) continue;
    if (stat === "matches_created") {
      referral.matchesCreated += 1;
    } else {
      referral.matchesJoined += 1;
    }
    store.byId[id] = referral;
  }
  await writeStore(store);
}
