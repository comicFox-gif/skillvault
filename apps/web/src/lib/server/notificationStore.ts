import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDatabaseSchema, getDatabase, isDatabaseConfigured } from "@/lib/server/db";

export type StoredPushSubscription = {
  endpoint: string;
  wallet: string;
  p256dh: string;
  auth: string;
  userAgent: string;
  createdAt: number;
  updatedAt: number;
  lastSuccessAt: number | null;
  lastError: string | null;
};

type PushSubscriptionInput = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

type Store = {
  byEndpoint: Record<string, StoredPushSubscription>;
};

const SERVERLESS_RUNTIME = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const STORE_DIR = SERVERLESS_RUNTIME ? path.join(os.tmpdir(), "skillvault-data") : path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "push-subscriptions.json");

function normalizeWallet(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function toEpoch(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isWallet(wallet: string) {
  return /^0x[a-f0-9]{40}$/.test(wallet);
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
    lower.includes("read-only file system") ||
    lower.includes("permission denied") ||
    lower.includes("database_url is not configured")
  );
}

function sanitizeSubscription(input: PushSubscriptionInput): {
  endpoint: string;
  p256dh: string;
  auth: string;
} {
  const endpoint = String(input?.endpoint ?? "").trim();
  const p256dh = String(input?.keys?.p256dh ?? "").trim();
  const auth = String(input?.keys?.auth ?? "").trim();
  if (!endpoint || !p256dh || !auth) {
    throw new Error("Invalid push subscription payload.");
  }
  return { endpoint, p256dh, auth };
}

function mapRow(row: Record<string, unknown>): StoredPushSubscription {
  return {
    endpoint: String(row.endpoint ?? ""),
    wallet: String(row.wallet ?? "").toLowerCase(),
    p256dh: String(row.p256dh ?? ""),
    auth: String(row.auth ?? ""),
    userAgent: String(row.user_agent ?? ""),
    createdAt: toEpoch(row.created_at),
    updatedAt: toEpoch(row.updated_at),
    lastSuccessAt: row.last_success_at == null ? null : toEpoch(row.last_success_at),
    lastError: row.last_error == null ? null : String(row.last_error),
  };
}

async function ensureStoreFile() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const empty: Store = { byEndpoint: {} };
    await fs.writeFile(STORE_PATH, JSON.stringify(empty, null, 2), "utf8");
  }
}

async function readStore(): Promise<Store> {
  await ensureStoreFile();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { byEndpoint: parsed.byEndpoint ?? {} };
  } catch {
    return { byEndpoint: {} };
  }
}

async function writeStore(store: Store) {
  await ensureStoreFile();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

async function upsertToDatabase(record: StoredPushSubscription) {
  await ensureDatabaseSchema();
  const db = getDatabase();
  await db`
    INSERT INTO push_subscriptions (
      endpoint,
      wallet,
      p256dh,
      auth,
      user_agent,
      created_at,
      updated_at,
      last_success_at,
      last_error
    ) VALUES (
      ${record.endpoint},
      ${record.wallet},
      ${record.p256dh},
      ${record.auth},
      ${record.userAgent},
      ${record.createdAt},
      ${record.updatedAt},
      ${record.lastSuccessAt},
      ${record.lastError}
    )
    ON CONFLICT (endpoint) DO UPDATE SET
      wallet = EXCLUDED.wallet,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      updated_at = EXCLUDED.updated_at
  `;
}

async function listFromDatabase(wallets: string[]) {
  if (!wallets.length) return [] as StoredPushSubscription[];
  await ensureDatabaseSchema();
  const db = getDatabase();
  const rows = await db`
    SELECT endpoint, wallet, p256dh, auth, user_agent, created_at, updated_at, last_success_at, last_error
    FROM push_subscriptions
    WHERE wallet IN ${db(wallets)}
  `;
  return rows.map((row) => mapRow(row as Record<string, unknown>));
}

async function deleteFromDatabase(endpoint: string) {
  await ensureDatabaseSchema();
  const db = getDatabase();
  await db`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
}

async function markDeliveryInDatabase(endpoint: string, success: boolean, errorText: string | null) {
  await ensureDatabaseSchema();
  const db = getDatabase();
  const now = Date.now();
  await db`
    UPDATE push_subscriptions
    SET
      updated_at = ${now},
      last_success_at = ${success ? now : null},
      last_error = ${success ? null : errorText}
    WHERE endpoint = ${endpoint}
  `;
}

export async function upsertPushSubscription(
  walletRaw: string,
  subscriptionRaw: PushSubscriptionInput,
  userAgentRaw?: string,
) {
  const wallet = normalizeWallet(walletRaw);
  if (!isWallet(wallet)) throw new Error("Invalid wallet.");
  const sanitized = sanitizeSubscription(subscriptionRaw);
  const now = Date.now();
  const record: StoredPushSubscription = {
    endpoint: sanitized.endpoint,
    wallet,
    p256dh: sanitized.p256dh,
    auth: sanitized.auth,
    userAgent: String(userAgentRaw ?? "").slice(0, 500),
    createdAt: now,
    updatedAt: now,
    lastSuccessAt: null,
    lastError: null,
  };

  if (isDatabaseConfigured()) {
    try {
      await upsertToDatabase(record);
      return record;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  const existing = store.byEndpoint[record.endpoint];
  record.createdAt = existing?.createdAt ?? now;
  store.byEndpoint[record.endpoint] = record;
  await writeStore(store);
  return record;
}

export async function listPushSubscriptionsForWallets(walletsRaw: string[]) {
  const wallets = Array.from(
    new Set(walletsRaw.map((wallet) => normalizeWallet(wallet)).filter((wallet) => isWallet(wallet))),
  );
  if (!wallets.length) return [] as StoredPushSubscription[];

  if (isDatabaseConfigured()) {
    try {
      return await listFromDatabase(wallets);
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  return Object.values(store.byEndpoint).filter((item) => wallets.includes(item.wallet));
}

export async function removePushSubscriptionByEndpoint(endpointRaw: string) {
  const endpoint = String(endpointRaw ?? "").trim();
  if (!endpoint) return;

  if (isDatabaseConfigured()) {
    try {
      await deleteFromDatabase(endpoint);
      return;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  delete store.byEndpoint[endpoint];
  await writeStore(store);
}

export async function markPushDelivery(
  endpointRaw: string,
  success: boolean,
  errorRaw?: string,
) {
  const endpoint = String(endpointRaw ?? "").trim();
  if (!endpoint) return;
  const errorText = success ? null : String(errorRaw ?? "").slice(0, 300) || "Delivery failed";

  if (isDatabaseConfigured()) {
    try {
      await markDeliveryInDatabase(endpoint, success, errorText);
      return;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  const existing = store.byEndpoint[endpoint];
  if (!existing) return;
  existing.updatedAt = Date.now();
  existing.lastSuccessAt = success ? Date.now() : existing.lastSuccessAt ?? null;
  existing.lastError = success ? null : errorText;
  store.byEndpoint[endpoint] = existing;
  await writeStore(store);
}
