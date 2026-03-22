import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type DisputeEvidenceItem } from "@/lib/disputeEvidence";
import {
  DISPUTE_AUTO_MESSAGE_TEXT,
  getDisputeAutoMessageText,
  type DisputeMessageItem,
  type DisputeStarterRole,
} from "@/lib/disputeMessages";
import { ensureDatabaseSchema, getDatabase, isDatabaseConfigured } from "@/lib/server/db";
import { getSupabaseAdminClient, isSupabaseConfigured } from "@/lib/server/supabaseAdmin";

type DisputeStore = {
  evidenceByMatch: Record<string, DisputeEvidenceItem[]>;
  messagesByMatch: Record<string, DisputeMessageItem[]>;
};

type ReputationPayload = {
  chainId: number;
  byWallet: Record<
    string,
    {
      wins: number;
      losses: number;
      resolved?: number;
      disputes: number;
      noResponseFlags?: number;
      entries: Array<{ matchId: string; opponent: string; result: "Win" | "Loss" | "Disputed" }>;
    }
  >;
};

export type ReputationSnapshot = {
  wallet: string;
  wins: number;
  losses: number;
  resolved?: number;
  disputes: number;
  noResponseFlags?: number;
  entries: Array<{ matchId: string; opponent: string; result: "Win" | "Loss" | "Disputed" }>;
  updatedAt: number;
};

const SERVERLESS_RUNTIME = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const STORE_DIR = SERVERLESS_RUNTIME ? path.join(os.tmpdir(), "skillvault-data") : path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "disputes.json");
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MIN_EVIDENCE_BYTES = 40 * 1024;
const MIN_NOTE_LEN = 12;
const SOCIAL_HANDLE_PATTERN =
  /(?:https?:\/\/|www\.|t\.me\/|wa\.me\/|discord\.gg\/|x\.com\/|twitter\.com\/|instagram\.com\/|facebook\.com\/|tiktok\.com\/|snapchat\.com\/|telegram|whatsapp|discord|instagram|facebook|tiktok|snapchat|twitter|\big\b|@\w{2,})/i;

function normalizeMatchId(matchId: string) {
  return String(matchId).trim();
}

function toEpoch(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeResult(value: unknown): "Win" | "Loss" | "Disputed" {
  if (value === "Win") return "Win";
  if (value === "Loss") return "Loss";
  if (value === "Disputed") return "Disputed";
  return "Loss";
}

function hasSocialHandleContent(message: string) {
  return SOCIAL_HANDLE_PATTERN.test(message);
}

function maskAsBlocked(message: string) {
  return message.replace(/[^\s]/g, "*");
}

function isMissingTableError(error: unknown) {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  return (
    message.includes("Could not find the table") ||
    message.includes("schema cache") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

function isRecoverableBackendError(error: unknown) {
  if (isMissingTableError(error)) return true;
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
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("row-level security") ||
    lower.includes("jwt") ||
    lower.includes("pgrst") ||
    lower.includes("fetch failed")
  );
}

async function ensureSqlSchemaIfAvailable() {
  if (isDatabaseConfigured()) {
    await ensureDatabaseSchema();
  }
}

async function ensureStoreFile() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const empty: DisputeStore = { evidenceByMatch: {}, messagesByMatch: {} };
    await fs.writeFile(STORE_PATH, JSON.stringify(empty, null, 2), "utf8");
  }
}

async function readStore(): Promise<DisputeStore> {
  await ensureStoreFile();
  const raw = await fs.readFile(STORE_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw) as Partial<DisputeStore>;
    return {
      evidenceByMatch: parsed.evidenceByMatch ?? {},
      messagesByMatch: parsed.messagesByMatch ?? {},
    };
  } catch {
    return { evidenceByMatch: {}, messagesByMatch: {} };
  }
}

async function writeStore(store: DisputeStore) {
  await ensureStoreFile();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function dataUrlToBytes(dataUrl: string) {
  const match = dataUrl.match(/^data:.*;base64,(.*)$/);
  if (!match?.[1]) return 0;
  try {
    return Buffer.from(match[1], "base64").byteLength;
  } catch {
    return 0;
  }
}

function mapEvidenceRow(row: any): DisputeEvidenceItem {
  return {
    id: String(row.id),
    matchId: String(row.match_id),
    uploader: String(row.uploader),
    createdAt: toEpoch(row.created_at),
    note: String(row.note ?? ""),
    attachmentName: String(row.attachment_name ?? "evidence-image"),
    attachmentSizeBytes: Number(row.attachment_size_bytes ?? 0),
    attachmentMimeType: String(row.attachment_mime_type ?? "image/*"),
    imageDataUrl: String(row.image_data_url ?? ""),
  };
}

function mapMessageRow(row: any): DisputeMessageItem {
  const rawRole = String(row.sender_role ?? "").toLowerCase();
  return {
    id: String(row.id),
    matchId: String(row.match_id),
    senderRole: rawRole === "admin" ? "admin" : rawRole === "player" ? "player" : "system",
    senderAddress: String(row.sender_address ?? ""),
    message: String(row.message ?? ""),
    createdAt: toEpoch(row.created_at),
  };
}

async function listEvidenceFromSupabase(matchId: string): Promise<DisputeEvidenceItem[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("dispute_evidence")
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapEvidenceRow);
}

async function listEvidenceFromDatabase(matchId: string): Promise<DisputeEvidenceItem[]> {
  await ensureSqlSchemaIfAvailable();
  const db = getDatabase();
  const rows = await db`
    SELECT
      id,
      match_id,
      uploader,
      created_at,
      note,
      attachment_name,
      attachment_size_bytes,
      attachment_mime_type,
      image_data_url
    FROM dispute_evidence
    WHERE match_id = ${matchId}
    ORDER BY created_at DESC
  `;
  return rows.map(mapEvidenceRow);
}

async function listEvidenceFromFile(matchId: string): Promise<DisputeEvidenceItem[]> {
  const store = await readStore();
  return [...(store.evidenceByMatch[matchId] ?? [])].sort((a, b) => b.createdAt - a.createdAt);
}

async function addEvidenceToSupabase(matchId: string, item: DisputeEvidenceItem) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("dispute_evidence").insert({
    id: item.id,
    match_id: matchId,
    uploader: item.uploader,
    created_at: item.createdAt,
    note: item.note,
    attachment_name: item.attachmentName,
    attachment_size_bytes: item.attachmentSizeBytes,
    attachment_mime_type: item.attachmentMimeType,
    image_data_url: item.imageDataUrl,
  });
  if (error) throw new Error(error.message);

  const { data: overflowRows, error: overflowErr } = await supabase
    .from("dispute_evidence")
    .select("id")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .range(100, 5000);
  if (overflowErr) throw new Error(overflowErr.message);

  const overflowIds = (overflowRows ?? []).map((row: any) => String(row.id));
  if (overflowIds.length > 0) {
    const { error: deleteErr } = await supabase.from("dispute_evidence").delete().in("id", overflowIds);
    if (deleteErr) throw new Error(deleteErr.message);
  }
}

async function addEvidenceToDatabase(matchId: string, item: DisputeEvidenceItem) {
  await ensureSqlSchemaIfAvailable();
  const db = getDatabase();
  await db`
    INSERT INTO dispute_evidence (
      id,
      match_id,
      uploader,
      created_at,
      note,
      attachment_name,
      attachment_size_bytes,
      attachment_mime_type,
      image_data_url
    ) VALUES (
      ${item.id},
      ${matchId},
      ${item.uploader},
      ${item.createdAt},
      ${item.note},
      ${item.attachmentName},
      ${item.attachmentSizeBytes},
      ${item.attachmentMimeType},
      ${item.imageDataUrl}
    )
  `;
  await db`
    DELETE FROM dispute_evidence
    WHERE match_id = ${matchId}
      AND id NOT IN (
        SELECT id
        FROM dispute_evidence
        WHERE match_id = ${matchId}
        ORDER BY created_at DESC
        LIMIT 100
      )
  `;
}

async function addEvidenceToFile(matchId: string, item: DisputeEvidenceItem) {
  const store = await readStore();
  const existing = store.evidenceByMatch[matchId] ?? [];
  store.evidenceByMatch[matchId] = [item, ...existing].slice(0, 100);
  await writeStore(store);
}

async function listMessagesFromSupabase(matchId: string): Promise<DisputeMessageItem[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("dispute_messages")
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapMessageRow);
}

async function listMessagesFromDatabase(matchId: string): Promise<DisputeMessageItem[]> {
  await ensureSqlSchemaIfAvailable();
  const db = getDatabase();
  const rows = await db`
    SELECT id, match_id, sender_role, sender_address, message, created_at
    FROM dispute_messages
    WHERE match_id = ${matchId}
    ORDER BY created_at ASC
  `;
  return rows.map(mapMessageRow);
}

async function listMessagesFromFile(matchId: string): Promise<DisputeMessageItem[]> {
  const store = await readStore();
  return [...(store.messagesByMatch[matchId] ?? [])].sort((a, b) => a.createdAt - b.createdAt);
}

async function addMessageToSupabase(matchId: string, item: DisputeMessageItem) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("dispute_messages").insert({
    id: item.id,
    match_id: matchId,
    sender_role: item.senderRole,
    sender_address: item.senderAddress,
    message: item.message,
    created_at: item.createdAt,
  });
  if (error) throw new Error(error.message);

  const { data: overflowRows, error: overflowErr } = await supabase
    .from("dispute_messages")
    .select("id")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .range(200, 5000);
  if (overflowErr) throw new Error(overflowErr.message);

  const overflowIds = (overflowRows ?? []).map((row: any) => String(row.id));
  if (overflowIds.length > 0) {
    const { error: deleteErr } = await supabase.from("dispute_messages").delete().in("id", overflowIds);
    if (deleteErr) throw new Error(deleteErr.message);
  }
}

async function addMessageToDatabase(matchId: string, item: DisputeMessageItem) {
  await ensureSqlSchemaIfAvailable();
  const db = getDatabase();
  await db`
    INSERT INTO dispute_messages (
      id,
      match_id,
      sender_role,
      sender_address,
      message,
      created_at
    ) VALUES (
      ${item.id},
      ${matchId},
      ${item.senderRole},
      ${item.senderAddress},
      ${item.message},
      ${item.createdAt}
    )
  `;
  await db`
    DELETE FROM dispute_messages
    WHERE match_id = ${matchId}
      AND id NOT IN (
        SELECT id
        FROM dispute_messages
        WHERE match_id = ${matchId}
        ORDER BY created_at DESC
        LIMIT 200
      )
  `;
}

async function addMessageToFile(matchId: string, item: DisputeMessageItem) {
  const store = await readStore();
  const existing = store.messagesByMatch[matchId] ?? [];
  store.messagesByMatch[matchId] = [...existing, item].slice(-200);
  await writeStore(store);
}

async function listKnownDisputeMatchIdsFromSupabase(): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  const [messageRows, evidenceRows] = await Promise.all([
    supabase.from("dispute_messages").select("match_id").limit(5000),
    supabase.from("dispute_evidence").select("match_id").limit(5000),
  ]);
  if (messageRows.error) throw new Error(messageRows.error.message);
  if (evidenceRows.error) throw new Error(evidenceRows.error.message);
  const all = [
    ...(messageRows.data ?? []).map((row: any) => String(row.match_id ?? "").trim()),
    ...(evidenceRows.data ?? []).map((row: any) => String(row.match_id ?? "").trim()),
  ];
  return Array.from(new Set(all.filter(Boolean)));
}

async function listKnownDisputeMatchIdsFromDatabase(): Promise<string[]> {
  await ensureSqlSchemaIfAvailable();
  const db = getDatabase();
  const rows = await db`
    SELECT DISTINCT match_id
    FROM (
      SELECT match_id FROM dispute_messages
      UNION ALL
      SELECT match_id FROM dispute_evidence
    ) AS ids
  `;
  return Array.from(new Set(rows.map((row: any) => String(row.match_id ?? "").trim()).filter(Boolean)));
}

async function listKnownDisputeMatchIdsFromFile(): Promise<string[]> {
  const store = await readStore();
  const keys = [
    ...Object.keys(store.messagesByMatch ?? {}),
    ...Object.keys(store.evidenceByMatch ?? {}),
  ];
  return Array.from(new Set(keys.map((id) => id.trim()).filter(Boolean)));
}

export async function listEvidence(matchId: string) {
  const key = normalizeMatchId(matchId);
  if (!key) return [];
  if (isSupabaseConfigured()) {
    try {
      return await listEvidenceFromSupabase(key);
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  if (isDatabaseConfigured()) {
    try {
      return await listEvidenceFromDatabase(key);
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  return listEvidenceFromFile(key);
}

export async function addEvidence(
  matchId: string,
  payload: Omit<DisputeEvidenceItem, "id" | "matchId" | "createdAt">,
) {
  const key = normalizeMatchId(matchId);
  const note = payload.note.trim();
  const bytes = payload.attachmentSizeBytes || dataUrlToBytes(payload.imageDataUrl);
  if (!payload.attachmentMimeType.startsWith("image/")) {
    throw new Error("Only image files are allowed.");
  }
  if (bytes > MAX_EVIDENCE_BYTES) {
    throw new Error("File is too large. Compress file and upload again.");
  }
  if (bytes < MIN_EVIDENCE_BYTES) {
    throw new Error("Evidence file looks too small. Upload a clear, real match screenshot.");
  }
  if (note.length < MIN_NOTE_LEN) {
    throw new Error("Add a short evidence note (at least 12 characters).");
  }

  const item: DisputeEvidenceItem = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    matchId: key,
    uploader: payload.uploader,
    createdAt: Date.now(),
    note,
    imageDataUrl: payload.imageDataUrl,
    attachmentName: payload.attachmentName || "evidence-image",
    attachmentSizeBytes: bytes,
    attachmentMimeType: payload.attachmentMimeType || "image/*",
  };

  if (isSupabaseConfigured()) {
    try {
      await addEvidenceToSupabase(key, item);
      return item;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  if (isDatabaseConfigured()) {
    try {
      await addEvidenceToDatabase(key, item);
      return item;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  await addEvidenceToFile(key, item);
  return item;
}

export async function listMessages(matchId: string) {
  const key = normalizeMatchId(matchId);
  if (!key) return [];
  if (isSupabaseConfigured()) {
    try {
      return await listMessagesFromSupabase(key);
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  if (isDatabaseConfigured()) {
    try {
      return await listMessagesFromDatabase(key);
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  return listMessagesFromFile(key);
}

export async function addMessage(
  matchId: string,
  payload: Omit<DisputeMessageItem, "id" | "matchId" | "createdAt">,
) {
  const key = normalizeMatchId(matchId);
  let message = payload.message.trim();
  if (!message) throw new Error("Message cannot be empty.");
  if (payload.senderRole !== "admin" && payload.senderRole !== "player" && payload.senderRole !== "system") {
    throw new Error("Invalid sender role.");
  }
  if (payload.senderRole === "player" && hasSocialHandleContent(message)) {
    message = maskAsBlocked(message);
  }

  const item: DisputeMessageItem = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    matchId: key,
    senderRole: payload.senderRole,
    senderAddress: payload.senderAddress,
    message,
    createdAt: Date.now(),
  };

  if (isSupabaseConfigured()) {
    try {
      await addMessageToSupabase(key, item);
      return item;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  if (isDatabaseConfigured()) {
    try {
      await addMessageToDatabase(key, item);
      return item;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  await addMessageToFile(key, item);
  return item;
}

export async function ensureAutoMessage(matchId: string, starterRole: DisputeStarterRole = "unknown") {
  const key = normalizeMatchId(matchId);
  if (!key) return;

  const existing = await listMessages(key);
  const hasIntro = existing.some((item) => {
    if (item.senderRole !== "system") return false;
    const msg = item.message.trim().toLowerCase();
    return msg.startsWith("a dispute has been started by") || msg === DISPUTE_AUTO_MESSAGE_TEXT.toLowerCase();
  });
  if (hasIntro) return;

  const intro = getDisputeAutoMessageText(starterRole);
  await addMessage(key, {
    senderRole: "system",
    senderAddress: "system",
    message: intro,
  });
}

export async function getReputationSnapshot(chainId: number, wallet: string): Promise<ReputationSnapshot | null> {
  const normalizedWallet = wallet.trim().toLowerCase();
  if (!normalizedWallet) return null;

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseAdminClient();
      const { data, error } = await supabase
        .from("wallet_reputation_cache")
        .select("*")
        .eq("chain_id", chainId)
        .eq("wallet", normalizedWallet)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;

      let entries: ReputationSnapshot["entries"] = [];
      try {
        const parsed = JSON.parse(String(data.entries_json ?? "[]"));
        if (Array.isArray(parsed)) {
          entries = parsed.map((item: any) => ({
            matchId: String(item?.matchId ?? ""),
            opponent: String(item?.opponent ?? ""),
            result: normalizeResult(item?.result),
          }));
        }
      } catch {
        entries = [];
      }

      return {
        wallet: String(data.wallet),
        wins: Number(data.wins ?? 0),
        losses: Number(data.losses ?? 0),
        resolved: Number(data.resolved ?? 0),
        disputes: Number(data.disputes ?? 0),
        noResponseFlags: Number(data.no_response_flags ?? 0),
        entries,
        updatedAt: toEpoch(data.updated_at),
      };
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  if (!isDatabaseConfigured()) return null;
  try {
    await ensureSqlSchemaIfAvailable();
    const db = getDatabase();
    const rows = await db`
      SELECT
        wallet,
        wins,
        losses,
        resolved,
        disputes,
        no_response_flags,
        entries_json,
        updated_at
      FROM wallet_reputation_cache
      WHERE chain_id = ${chainId} AND wallet = ${normalizedWallet}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;

    let entries: ReputationSnapshot["entries"] = [];
    try {
      const parsed = JSON.parse(String(row.entries_json ?? "[]"));
      if (Array.isArray(parsed)) {
        entries = parsed.map((item: any) => ({
          matchId: String(item?.matchId ?? ""),
          opponent: String(item?.opponent ?? ""),
          result: normalizeResult(item?.result),
        }));
      }
    } catch {
      entries = [];
    }

    return {
      wallet: String(row.wallet),
      wins: Number(row.wins ?? 0),
      losses: Number(row.losses ?? 0),
      resolved: Number(row.resolved ?? 0),
      disputes: Number(row.disputes ?? 0),
      noResponseFlags: Number(row.no_response_flags ?? 0),
      entries,
      updatedAt: toEpoch(row.updated_at),
    };
  } catch (error) {
    if (!isRecoverableBackendError(error)) throw error;
    return null;
  }
}

export async function saveReputationSnapshot(payload: ReputationPayload) {
  const chainId = Number(payload.chainId);
  const now = Date.now();

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseAdminClient();
      const rows = Object.entries(payload.byWallet).map(([wallet, stats]) => ({
        chain_id: chainId,
        wallet: wallet.toLowerCase(),
        wins: stats.wins || 0,
        losses: stats.losses || 0,
        resolved: stats.resolved || 0,
        disputes: stats.disputes || 0,
        no_response_flags: stats.noResponseFlags || 0,
        entries_json: JSON.stringify((stats.entries ?? []).slice(0, 12)),
        updated_at: now,
      }));
      if (rows.length === 0) return;
      const { error } = await supabase
        .from("wallet_reputation_cache")
        .upsert(rows, { onConflict: "chain_id,wallet" });
      if (error) throw new Error(error.message);
      return;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }

  if (!isDatabaseConfigured()) return;
  try {
    await ensureSqlSchemaIfAvailable();
    const db = getDatabase();
    const writes = Object.entries(payload.byWallet).map(async ([wallet, stats]) => {
      const normalizedWallet = wallet.toLowerCase();
      const entriesJson = JSON.stringify((stats.entries ?? []).slice(0, 12));
      await db`
        INSERT INTO wallet_reputation_cache (
          chain_id,
          wallet,
          wins,
          losses,
          resolved,
          disputes,
          no_response_flags,
          entries_json,
          updated_at
        ) VALUES (
          ${chainId},
          ${normalizedWallet},
          ${stats.wins || 0},
          ${stats.losses || 0},
          ${stats.resolved || 0},
          ${stats.disputes || 0},
          ${stats.noResponseFlags || 0},
          ${entriesJson},
          ${now}
        )
        ON CONFLICT (chain_id, wallet)
        DO UPDATE SET
          wins = EXCLUDED.wins,
          losses = EXCLUDED.losses,
          resolved = EXCLUDED.resolved,
          disputes = EXCLUDED.disputes,
          no_response_flags = EXCLUDED.no_response_flags,
          entries_json = EXCLUDED.entries_json,
          updated_at = EXCLUDED.updated_at
      `;
    });
    await Promise.all(writes);
  } catch (error) {
    if (!isRecoverableBackendError(error)) throw error;
  }
}

export async function listKnownDisputeMatchIds() {
  if (isSupabaseConfigured()) {
    try {
      return await listKnownDisputeMatchIdsFromSupabase();
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  if (isDatabaseConfigured()) {
    try {
      return await listKnownDisputeMatchIdsFromDatabase();
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  return listKnownDisputeMatchIdsFromFile();
}
