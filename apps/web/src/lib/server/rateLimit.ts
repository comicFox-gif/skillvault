type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitCheckInput = {
  request: Request;
  key: string;
  max: number;
  windowMs: number;
};

export type RateLimitResult = {
  ok: boolean;
  key: string;
  remaining: number;
  retryAfterSec: number;
  max: number;
  windowMs: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __skillvault_rate_limit_store__: Map<string, RateLimitEntry> | undefined;
}

const MAX_TRACKED_KEYS = 20_000;
const DB_SYNC_INTERVAL_MS = 30_000;
const DB_CLEANUP_INTERVAL_MS = 120_000;

let dbSyncScheduled = false;
let dbCleanupScheduled = false;
const dirtyKeys = new Set<string>();

function getStore() {
  if (!globalThis.__skillvault_rate_limit_store__) {
    globalThis.__skillvault_rate_limit_store__ = new Map<string, RateLimitEntry>();
  }
  return globalThis.__skillvault_rate_limit_store__;
}

function getClientIp(request: Request) {
  const forwarded =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-vercel-forwarded-for") ||
    "";
  const first = forwarded.split(",")[0]?.trim();
  if (first) return first;
  return "unknown-ip";
}

function compactStore(store: Map<string, RateLimitEntry>, now: number) {
  if (store.size < MAX_TRACKED_KEYS) return;
  for (const [key, value] of store.entries()) {
    if (value.resetAt <= now) {
      store.delete(key);
    }
  }
  if (store.size <= MAX_TRACKED_KEYS) return;
  const overflow = store.size - MAX_TRACKED_KEYS;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function getDb() {
  try {
    const { isDatabaseConfigured, getDatabase } = require("@/lib/server/db");
    if (!isDatabaseConfigured()) return null;
    return getDatabase();
  } catch {
    return null;
  }
}

async function ensureRateLimitTable() {
  const db = getDb();
  if (!db) return;
  try {
    await db`
      CREATE TABLE IF NOT EXISTS rate_limit_entries (
        bucket_key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at BIGINT NOT NULL
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS rate_limit_entries_reset_idx
      ON rate_limit_entries (reset_at)
    `;
  } catch {
    // table creation is best-effort
  }
}

let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  tableEnsured = true;
  await ensureRateLimitTable();
}

async function syncDirtyKeysToDb() {
  if (dirtyKeys.size === 0) return;
  const db = getDb();
  if (!db) {
    dirtyKeys.clear();
    return;
  }
  await ensureTable();
  const store = getStore();
  const now = Date.now();
  const keysToSync = Array.from(dirtyKeys);
  dirtyKeys.clear();

  try {
    for (const key of keysToSync) {
      const entry = store.get(key);
      if (!entry || entry.resetAt <= now) {
        await db`DELETE FROM rate_limit_entries WHERE bucket_key = ${key}`.catch(() => {});
      } else {
        await db`
          INSERT INTO rate_limit_entries (bucket_key, count, reset_at)
          VALUES (${key}, ${entry.count}, ${entry.resetAt})
          ON CONFLICT (bucket_key) DO UPDATE SET
            count = EXCLUDED.count,
            reset_at = EXCLUDED.reset_at
        `.catch(() => {});
      }
    }
  } catch {
    // best-effort sync
  }
}

async function cleanupExpiredDbEntries() {
  const db = getDb();
  if (!db) return;
  try {
    await ensureTable();
    await db`DELETE FROM rate_limit_entries WHERE reset_at <= ${Date.now()}`;
  } catch {
    // best-effort cleanup
  }
}

function scheduleDbSync() {
  if (dbSyncScheduled) return;
  dbSyncScheduled = true;
  setTimeout(async () => {
    dbSyncScheduled = false;
    await syncDirtyKeysToDb();
  }, DB_SYNC_INTERVAL_MS);
}

function scheduleDbCleanup() {
  if (dbCleanupScheduled) return;
  dbCleanupScheduled = true;
  setTimeout(async () => {
    dbCleanupScheduled = false;
    await cleanupExpiredDbEntries();
  }, DB_CLEANUP_INTERVAL_MS);
}

async function loadFromDb(bucketKey: string): Promise<RateLimitEntry | null> {
  const db = getDb();
  if (!db) return null;
  try {
    await ensureTable();
    const rows = await db`
      SELECT count, reset_at FROM rate_limit_entries
      WHERE bucket_key = ${bucketKey}
      LIMIT 1
    `;
    if (!rows.length) return null;
    return {
      count: Number(rows[0].count),
      resetAt: Number(rows[0].reset_at),
    };
  } catch {
    return null;
  }
}

export function checkRateLimit(input: RateLimitCheckInput): RateLimitResult {
  const { request, key, max, windowMs } = input;
  const safeMax = Math.max(1, Math.floor(Number(max) || 1));
  const safeWindow = Math.max(1000, Math.floor(Number(windowMs) || 1000));
  const now = Date.now();
  const store = getStore();
  compactStore(store, now);

  const clientIp = getClientIp(request);
  const bucketKey = `${key}:${clientIp}`;
  let previous = store.get(bucketKey);

  // Try loading from DB if not in memory (cold start recovery)
  if (!previous) {
    // Fire async DB load for next request — don't block current one
    void loadFromDb(bucketKey).then((dbEntry) => {
      if (dbEntry && dbEntry.resetAt > Date.now() && !store.has(bucketKey)) {
        store.set(bucketKey, dbEntry);
      }
    });
  }

  if (!previous || previous.resetAt <= now) {
    const next: RateLimitEntry = {
      count: 1,
      resetAt: now + safeWindow,
    };
    store.set(bucketKey, next);
    dirtyKeys.add(bucketKey);
    scheduleDbSync();
    scheduleDbCleanup();
    return {
      ok: true,
      key: bucketKey,
      remaining: safeMax - 1,
      retryAfterSec: Math.ceil(safeWindow / 1000),
      max: safeMax,
      windowMs: safeWindow,
    };
  }

  if (previous.count >= safeMax) {
    return {
      ok: false,
      key: bucketKey,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((previous.resetAt - now) / 1000)),
      max: safeMax,
      windowMs: safeWindow,
    };
  }

  previous.count += 1;
  store.set(bucketKey, previous);
  dirtyKeys.add(bucketKey);
  scheduleDbSync();
  return {
    ok: true,
    key: bucketKey,
    remaining: safeMax - previous.count,
    retryAfterSec: Math.max(1, Math.ceil((previous.resetAt - now) / 1000)),
    max: safeMax,
    windowMs: safeWindow,
  };
}
