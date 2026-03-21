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

export function checkRateLimit(input: RateLimitCheckInput): RateLimitResult {
  const { request, key, max, windowMs } = input;
  const safeMax = Math.max(1, Math.floor(Number(max) || 1));
  const safeWindow = Math.max(1000, Math.floor(Number(windowMs) || 1000));
  const now = Date.now();
  const store = getStore();
  compactStore(store, now);

  const clientIp = getClientIp(request);
  const bucketKey = `${key}:${clientIp}`;
  const previous = store.get(bucketKey);

  if (!previous || previous.resetAt <= now) {
    const next: RateLimitEntry = {
      count: 1,
      resetAt: now + safeWindow,
    };
    store.set(bucketKey, next);
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
  return {
    ok: true,
    key: bucketKey,
    remaining: safeMax - previous.count,
    retryAfterSec: Math.max(1, Math.ceil((previous.resetAt - now) / 1000)),
    max: safeMax,
    windowMs: safeWindow,
  };
}
