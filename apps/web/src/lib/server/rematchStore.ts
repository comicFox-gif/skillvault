import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDatabaseSchema, getDatabase, isDatabaseConfigured } from "@/lib/server/db";

export type RematchStatus = "pending" | "joined" | "cancelled";

export type RematchIntent = {
  oldMatchId: string;
  newMatchId: string;
  newRoomCode: string;
  requestedBy: string;
  requestedByRole: "creator" | "opponent";
  creator: string;
  opponent: string;
  stake: string;
  timeframe: string;
  joinMins: string;
  game: string;
  platform: string;
  status: RematchStatus;
  createdAt: number;
  updatedAt: number;
  joinedBy?: string;
  cancelledBy?: string;
};

type Store = {
  byOldMatchId: Record<string, RematchIntent>;
};

const SERVERLESS_RUNTIME = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const STORE_DIR = SERVERLESS_RUNTIME ? path.join(os.tmpdir(), "skillvault-data") : path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "rematch-intents.json");

function toEpoch(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeMatchId(matchId: string) {
  return String(matchId ?? "").trim();
}

function normalizeAddress(value: string) {
  return String(value ?? "").trim().toLowerCase();
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

function mapRow(row: any): RematchIntent {
  return {
    oldMatchId: String(row.old_match_id),
    newMatchId: String(row.new_match_id),
    newRoomCode: String(row.new_room_code),
    requestedBy: String(row.requested_by),
    requestedByRole: String(row.requested_by_role) === "opponent" ? "opponent" : "creator",
    creator: String(row.creator),
    opponent: String(row.opponent),
    stake: String(row.stake),
    timeframe: String(row.timeframe),
    joinMins: String(row.join_mins),
    game: String(row.game),
    platform: String(row.platform),
    status: (String(row.status) === "joined" || String(row.status) === "cancelled"
      ? String(row.status)
      : "pending") as RematchStatus,
    createdAt: toEpoch(row.created_at),
    updatedAt: toEpoch(row.updated_at),
    joinedBy: row.joined_by ? String(row.joined_by) : undefined,
    cancelledBy: row.cancelled_by ? String(row.cancelled_by) : undefined,
  };
}

async function ensureStoreFile() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const empty: Store = { byOldMatchId: {} };
    await fs.writeFile(STORE_PATH, JSON.stringify(empty, null, 2), "utf8");
  }
}

async function readStore(): Promise<Store> {
  await ensureStoreFile();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { byOldMatchId: parsed.byOldMatchId ?? {} };
  } catch {
    return { byOldMatchId: {} };
  }
}

async function writeStore(store: Store) {
  await ensureStoreFile();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function buildIntent(
  oldMatchId: string,
  payload: Omit<RematchIntent, "oldMatchId" | "status" | "createdAt" | "updatedAt">,
): RematchIntent {
  const now = Date.now();
  return {
    oldMatchId,
    newMatchId: String(payload.newMatchId ?? "").trim(),
    newRoomCode: String(payload.newRoomCode ?? "").trim(),
    requestedBy: normalizeAddress(payload.requestedBy),
    requestedByRole: payload.requestedByRole === "opponent" ? "opponent" : "creator",
    creator: normalizeAddress(payload.creator),
    opponent: normalizeAddress(payload.opponent),
    stake: String(payload.stake ?? "").trim(),
    timeframe: String(payload.timeframe ?? "").trim(),
    joinMins: String(payload.joinMins ?? "").trim(),
    game: String(payload.game ?? "").trim(),
    platform: String(payload.platform ?? "").trim(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

function validateIntent(intent: RematchIntent) {
  return Boolean(
    intent.oldMatchId &&
      intent.newMatchId &&
      intent.newRoomCode &&
      intent.requestedBy &&
      intent.creator &&
      intent.opponent,
  );
}

async function getFromDatabase(oldMatchId: string): Promise<RematchIntent | null> {
  await ensureDatabaseSchema();
  const db = getDatabase();
  const rows = await db`
    SELECT
      old_match_id,
      new_match_id,
      new_room_code,
      requested_by,
      requested_by_role,
      creator,
      opponent,
      stake,
      timeframe,
      join_mins,
      game,
      platform,
      status,
      created_at,
      updated_at,
      joined_by,
      cancelled_by
    FROM rematch_intents
    WHERE old_match_id = ${oldMatchId}
    LIMIT 1
  `;
  if (!rows.length) return null;
  return mapRow(rows[0]);
}

async function upsertToDatabase(intent: RematchIntent) {
  await ensureDatabaseSchema();
  const db = getDatabase();
  await db`
    INSERT INTO rematch_intents (
      old_match_id,
      new_match_id,
      new_room_code,
      requested_by,
      requested_by_role,
      creator,
      opponent,
      stake,
      timeframe,
      join_mins,
      game,
      platform,
      status,
      created_at,
      updated_at,
      joined_by,
      cancelled_by
    ) VALUES (
      ${intent.oldMatchId},
      ${intent.newMatchId},
      ${intent.newRoomCode},
      ${intent.requestedBy},
      ${intent.requestedByRole},
      ${intent.creator},
      ${intent.opponent},
      ${intent.stake},
      ${intent.timeframe},
      ${intent.joinMins},
      ${intent.game},
      ${intent.platform},
      ${intent.status},
      ${intent.createdAt},
      ${intent.updatedAt},
      ${intent.joinedBy ?? null},
      ${intent.cancelledBy ?? null}
    )
    ON CONFLICT (old_match_id) DO UPDATE SET
      new_match_id = EXCLUDED.new_match_id,
      new_room_code = EXCLUDED.new_room_code,
      requested_by = EXCLUDED.requested_by,
      requested_by_role = EXCLUDED.requested_by_role,
      creator = EXCLUDED.creator,
      opponent = EXCLUDED.opponent,
      stake = EXCLUDED.stake,
      timeframe = EXCLUDED.timeframe,
      join_mins = EXCLUDED.join_mins,
      game = EXCLUDED.game,
      platform = EXCLUDED.platform,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at,
      joined_by = EXCLUDED.joined_by,
      cancelled_by = EXCLUDED.cancelled_by
  `;
}

export async function getRematchIntent(oldMatchIdRaw: string): Promise<RematchIntent | null> {
  const oldMatchId = normalizeMatchId(oldMatchIdRaw);
  if (!oldMatchId) return null;

  if (isDatabaseConfigured()) {
    try {
      return await getFromDatabase(oldMatchId);
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  return store.byOldMatchId[oldMatchId] ?? null;
}

export async function createRematchIntent(
  oldMatchIdRaw: string,
  payload: Omit<RematchIntent, "oldMatchId" | "status" | "createdAt" | "updatedAt">,
): Promise<RematchIntent> {
  const oldMatchId = normalizeMatchId(oldMatchIdRaw);
  if (!oldMatchId) throw new Error("Invalid match id");
  const item = buildIntent(oldMatchId, payload);
  if (!validateIntent(item)) throw new Error("Invalid rematch create payload");

  if (isDatabaseConfigured()) {
    try {
      await upsertToDatabase(item);
      return item;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  store.byOldMatchId[oldMatchId] = item;
  await writeStore(store);
  return item;
}

export async function updateRematchIntentStatus(
  oldMatchIdRaw: string,
  action: "join" | "cancel",
  actorRaw?: string,
): Promise<RematchIntent | null> {
  const oldMatchId = normalizeMatchId(oldMatchIdRaw);
  if (!oldMatchId) throw new Error("Invalid match id");
  const actor = normalizeAddress(actorRaw ?? "");

  let existing: RematchIntent | null = null;
  if (isDatabaseConfigured()) {
    try {
      existing = await getFromDatabase(oldMatchId);
      if (!existing) return null;
      existing.updatedAt = Date.now();
      if (action === "join") {
        existing.status = "joined";
        if (actor) existing.joinedBy = actor;
      } else {
        existing.status = "cancelled";
        if (actor) existing.cancelledBy = actor;
      }
      await upsertToDatabase(existing);
      return existing;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  const store = await readStore();
  const item = store.byOldMatchId[oldMatchId];
  if (!item) return null;
  item.updatedAt = Date.now();
  if (action === "join") {
    item.status = "joined";
    if (actor) item.joinedBy = actor;
  } else {
    item.status = "cancelled";
    if (actor) item.cancelledBy = actor;
  }
  store.byOldMatchId[oldMatchId] = item;
  await writeStore(store);
  return item;
}
