import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPublicClient, http, zeroAddress, type Address } from "viem";
import { decodeMatchCode, encodeMatchCode } from "@/lib/matchCode";
import { ensureDatabaseSchema, getDatabase, isDatabaseConfigured } from "@/lib/server/db";

export type TournamentFormat = "bracket" | "league";
export type TournamentStatus = "open" | "full" | "in_progress" | "completed";
export type TournamentMatchResult = "pending" | "home_win" | "away_win" | "draw" | "bye_home";

export type TournamentEntry = {
  id: string;
  tournamentId: string;
  wallet: string;
  username: string;
  joinedAt: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  stakeLocked: boolean;
  stakeChainId: number | null;
  stakeEscrowMatchId: string | null;
  stakeEscrowRoomCode: string | null;
  stakeLockedAt: number | null;
};

export type TournamentMatch = {
  id: string;
  tournamentId: string;
  roundNo: number;
  homeWallet: string;
  awayWallet: string | null;
  homeUsername: string;
  awayUsername: string | null;
  homeScore: number | null;
  awayScore: number | null;
  result: TournamentMatchResult;
  winnerWallet: string | null;
  escrowChainId: number | null;
  escrowMatchId: string | null;
  escrowRoomCode: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TournamentSummary = {
  id: string;
  title: string;
  game: string;
  platform: string;
  size: number;
  timeframeMins: number;
  format: TournamentFormat;
  pointsTarget: number | null;
  stakeWei: string;
  stakeChainId: number;
  status: TournamentStatus;
  createdByWallet: string;
  createdByUsername: string;
  createdAt: number;
  updatedAt: number;
  participantCount: number;
};

export type TournamentDetail = TournamentSummary & {
  entries: TournamentEntry[];
  matches: TournamentMatch[];
};

type CreateTournamentPayload = {
  title: string;
  game: string;
  platform: string;
  size: number;
  timeframeMins: number;
  format?: TournamentFormat;
  pointsTarget?: number | null;
  stakeWei: string;
  stakeChainId: number;
  creatorStakeEscrowMatchId: string;
  creatorWallet: string;
  creatorUsername: string;
};

type LinkEscrowPayload = {
  linkerWallet?: string;
  chainId: number;
  roomCode: string;
};

type DiskStore = { byId: Record<string, TournamentDetail> };

type EscrowChainConfig = {
  chainId: number;
  rpcUrl: string;
  escrowAddress: Address;
};

type EscrowMatchData = readonly [
  Address,
  Address,
  bigint,
  bigint,
  bigint | number,
  boolean,
  boolean,
  Address,
];

const escrowAbi = [
  {
    type: "function",
    name: "getMatch",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "opponent", type: "address" },
      { name: "stake", type: "uint256" },
      { name: "joinedAt", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "creatorPaid", type: "bool" },
      { name: "opponentPaid", type: "bool" },
      { name: "proposedWinner", type: "address" },
    ],
  },
  {
    type: "function",
    name: "resolvedWinner",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const SERVERLESS_RUNTIME = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const STORE_DIR = SERVERLESS_RUNTIME ? path.join(os.tmpdir(), "skillvault-data") : path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "tournaments-v2.json");

function defaultStakeChainId() {
  return configuredEscrowChains()[0]?.chainId ?? 420420417;
}

function toEpoch(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeId(value: string) {
  return String(value ?? "").trim();
}

function normalizeWallet(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function validateWallet(wallet: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error("Invalid wallet address.");
}

function sanitizeText(value: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeFormat(value: unknown): TournamentFormat {
  return String(value ?? "").toLowerCase() === "league" ? "league" : "bracket";
}

function normalizeStatus(value: unknown): TournamentStatus {
  const x = String(value ?? "");
  return x === "open" || x === "full" || x === "in_progress" || x === "completed" ? x : "open";
}

function normalizeResult(value: unknown): TournamentMatchResult {
  const x = String(value ?? "");
  return x === "pending" || x === "home_win" || x === "away_win" || x === "draw" || x === "bye_home"
    ? x
    : "pending";
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeStakeWei(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) throw new Error("Invalid stake amount.");
  const amount = BigInt(normalized);
  if (amount <= 0n) throw new Error("Stake amount must be greater than zero.");
  return amount.toString();
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function sortEntries(entries: TournamentEntry[]) {
  return [...entries].sort(
    (a, b) => b.points - a.points || b.wins - a.wins || b.draws - a.draws || a.losses - b.losses || a.joinedAt - b.joinedAt,
  );
}

function sortMatches(matches: TournamentMatch[]) {
  return [...matches].sort((a, b) => a.roundNo - b.roundNo || a.createdAt - b.createdAt);
}

function nextPow2(n: number) {
  let x = 1;
  while (x < n) x *= 2;
  return x;
}

function recomputeStats(entries: TournamentEntry[], matches: TournamentMatch[]) {
  const map = new Map<string, TournamentEntry>(
    entries.map((entry) => [entry.wallet, { ...entry, played: 0, wins: 0, draws: 0, losses: 0, points: 0 }]),
  );
  for (const match of matches) {
    if (match.result === "pending") continue;
    const home = map.get(match.homeWallet);
    const away = match.awayWallet ? map.get(match.awayWallet) : undefined;
    if (!home) continue;
    if (match.result === "home_win" || match.result === "bye_home") {
      home.played += 1;
      home.wins += 1;
      home.points += 3;
      if (away) {
        away.played += 1;
        away.losses += 1;
      }
    } else if (match.result === "away_win") {
      home.played += 1;
      home.losses += 1;
      if (away) {
        away.played += 1;
        away.wins += 1;
        away.points += 3;
      }
    } else if (match.result === "draw" && away) {
      home.played += 1;
      away.played += 1;
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }
  return sortEntries(Array.from(map.values()));
}

function isBracketComplete(matches: TournamentMatch[]) {
  if (matches.length === 0) return false;
  const highest = Math.max(...matches.map((m) => m.roundNo));
  const inRound = matches.filter((m) => m.roundNo === highest);
  if (inRound.some((m) => m.result === "pending")) return false;
  const winners = new Set(inRound.map((m) => m.winnerWallet).filter((w): w is string => Boolean(w)));
  return winners.size <= 1;
}

function leagueComplete(entries: TournamentEntry[], target: number | null, matches: TournamentMatch[]) {
  if (target && entries.some((entry) => entry.points >= target)) return true;
  return matches.length > 0 && matches.every((match) => match.result !== "pending");
}

function buildBracketRound(players: Array<{ wallet: string; username: string }>, tournamentId: string, roundNo: number, now: number) {
  const slots: Array<{ wallet: string; username: string } | null> = [...players];
  const size = nextPow2(players.length);
  while (slots.length < size) slots.push(null);
  const rows: TournamentMatch[] = [];
  for (let i = 0; i < slots.length; i += 2) {
    const first = slots[i];
    const second = slots[i + 1];
    if (!first && !second) continue;
    if (first && second) {
      rows.push({
        id: makeId(`tm-${tournamentId}`),
        tournamentId,
        roundNo,
        homeWallet: first.wallet,
        awayWallet: second.wallet,
        homeUsername: first.username,
        awayUsername: second.username,
        homeScore: null,
        awayScore: null,
        result: "pending",
        winnerWallet: null,
        escrowChainId: null,
        escrowMatchId: null,
        escrowRoomCode: null,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const winner = first ?? second!;
      rows.push({
        id: makeId(`tm-${tournamentId}`),
        tournamentId,
        roundNo,
        homeWallet: winner.wallet,
        awayWallet: null,
        homeUsername: winner.username,
        awayUsername: null,
        homeScore: 1,
        awayScore: 0,
        result: "bye_home",
        winnerWallet: winner.wallet,
        escrowChainId: null,
        escrowMatchId: null,
        escrowRoomCode: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return rows;
}

function buildRoundRobin(entries: TournamentEntry[], tournamentId: string, now: number) {
  const slots: Array<{ wallet: string; username: string } | null> = entries.map((entry) => ({ wallet: entry.wallet, username: entry.username }));
  if (slots.length % 2 !== 0) slots.push(null);
  if (slots.length < 2) return [] as TournamentMatch[];
  const rounds = slots.length - 1;
  let rotation = [...slots];
  const rows: TournamentMatch[] = [];
  for (let r = 1; r <= rounds; r += 1) {
    for (let i = 0; i < rotation.length / 2; i += 1) {
      const home = rotation[i];
      const away = rotation[rotation.length - 1 - i];
      if (!home || !away) continue;
      rows.push({
        id: makeId(`tm-${tournamentId}`),
        tournamentId,
        roundNo: r,
        homeWallet: home.wallet,
        awayWallet: away.wallet,
        homeUsername: home.username,
        awayUsername: away.username,
        homeScore: null,
        awayScore: null,
        result: "pending",
        winnerWallet: null,
        escrowChainId: null,
        escrowMatchId: null,
        escrowRoomCode: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    const fixed = rotation[0];
    const rest = rotation.slice(1);
    const last = rest.pop() ?? null;
    rest.unshift(last);
    rotation = [fixed, ...rest];
  }
  return rows;
}

function autoAdvanceBracket(detail: TournamentDetail) {
  let matches = sortMatches(detail.matches);
  for (let guard = 0; guard < 20; guard += 1) {
    if (matches.length === 0) break;
    const highest = Math.max(...matches.map((m) => m.roundNo));
    const roundMatches = matches.filter((m) => m.roundNo === highest);
    if (roundMatches.some((m) => m.result === "pending")) break;
    const winners = roundMatches
      .map((m) => {
        if (!m.winnerWallet) return null;
        return {
          wallet: m.winnerWallet,
          username: m.winnerWallet === m.homeWallet ? m.homeUsername : (m.awayUsername ?? m.homeUsername),
        };
      })
      .filter((x): x is { wallet: string; username: string } => Boolean(x));
    const unique = Array.from(new Map(winners.map((x) => [x.wallet, x])).values());
    if (unique.length <= 1) break;
    const next = buildBracketRound(unique, detail.id, highest + 1, Date.now());
    if (next.length === 0) break;
    matches = sortMatches([...matches, ...next]);
  }
  return matches;
}

function finalizeTournament(detail: TournamentDetail, incomingMatches: TournamentMatch[], updatedAt = Date.now()): TournamentDetail {
  let matches = sortMatches(incomingMatches);
  if (detail.format === "bracket") {
    matches = autoAdvanceBracket({ ...detail, matches });
  }
  const entries = recomputeStats(detail.entries, matches);
  const status: TournamentStatus =
    detail.format === "league"
      ? leagueComplete(entries, detail.pointsTarget, matches) ? "completed" : "in_progress"
      : isBracketComplete(matches) ? "completed" : "in_progress";
  return { ...detail, entries, matches, status, updatedAt, participantCount: entries.length };
}

function applyBootstrap(detail: TournamentDetail): TournamentDetail {
  if (detail.entries.length < detail.size) return detail;
  if (detail.matches.length > 0) return detail;
  const now = Date.now();
  const matches =
    detail.format === "league"
      ? buildRoundRobin(detail.entries, detail.id, now)
      : buildBracketRound(detail.entries.map((e) => ({ wallet: e.wallet, username: e.username })), detail.id, 1, now);
  return finalizeTournament(detail, matches, now);
}

function resolveMatchFromWinner(
  detail: TournamentDetail,
  tournamentMatchId: string,
  winnerWallet: string | null,
): TournamentDetail {
  const match = detail.matches.find((row) => row.id === tournamentMatchId);
  if (!match || match.result !== "pending" || !match.awayWallet) return detail;

  const now = Date.now();
  const home = match.homeWallet.toLowerCase();
  const away = match.awayWallet.toLowerCase();
  const winner = winnerWallet ? winnerWallet.toLowerCase() : null;

  if (!winner) {
    if (detail.format === "bracket") return detail;
    match.result = "draw";
    match.winnerWallet = null;
    match.homeScore = 1;
    match.awayScore = 1;
    match.updatedAt = now;
    return finalizeTournament(detail, [...detail.matches], now);
  }

  if (winner !== home && winner !== away) return detail;
  match.result = winner === home ? "home_win" : "away_win";
  match.winnerWallet = winner;
  match.homeScore = winner === home ? 1 : 0;
  match.awayScore = winner === away ? 1 : 0;
  match.updatedAt = now;
  return finalizeTournament(detail, [...detail.matches], now);
}

function validateCreatePayload(payload: CreateTournamentPayload) {
  const title = sanitizeText(payload.title);
  const game = sanitizeText(payload.game);
  const platform = sanitizeText(payload.platform);
  const size = Number(payload.size);
  const timeframeMins = Number(payload.timeframeMins);
  const format = normalizeFormat(payload.format ?? "bracket");
  const leaguePointsTarget = Number(payload.pointsTarget ?? 30);
  const pointsTarget = format === "league" ? leaguePointsTarget : null;
  const stakeWei = normalizeStakeWei(payload.stakeWei);
  const stakeChainId = Number(payload.stakeChainId);
  const creatorStakeEscrowMatchId = String(payload.creatorStakeEscrowMatchId ?? "").trim();
  const creatorWallet = normalizeWallet(payload.creatorWallet);
  const creatorUsername = sanitizeText(payload.creatorUsername);
  validateWallet(creatorWallet);
  if (creatorUsername.length < 3 || creatorUsername.length > 24) throw new Error("Username must be 3-24 characters.");
  if (title.length < 3 || title.length > 80) throw new Error("Tournament title must be 3-80 characters.");
  if (!Number.isInteger(size) || size < 4 || size > 16) throw new Error("Tournament size must be 4-16.");
  if (!Number.isInteger(timeframeMins) || timeframeMins < 4 || timeframeMins > 60) throw new Error("Timeframe must be 4-60 mins.");
  if (format === "league" && (!Number.isInteger(leaguePointsTarget) || leaguePointsTarget < 10)) {
    throw new Error("League points target must be at least 10.");
  }
  if (!Number.isInteger(stakeChainId) || stakeChainId <= 0) throw new Error("Invalid stake chain.");
  if (!getEscrowChainConfig(stakeChainId)) throw new Error("Stake chain is not configured.");
  if (!/^\d+$/.test(creatorStakeEscrowMatchId)) throw new Error("Invalid creator stake lock id.");
  return {
    title,
    game,
    platform,
    size,
    timeframeMins,
    format,
    pointsTarget,
    stakeWei,
    stakeChainId,
    creatorStakeEscrowMatchId,
    creatorWallet,
    creatorUsername,
  };
}

function isRecoverableBackendError(error: unknown) {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  const lower = message.toLowerCase();
  return lower.includes("database_url is not configured") || lower.includes("enotfound") || lower.includes("econnrefused");
}

function configuredEscrowChains(): EscrowChainConfig[] {
  const values: EscrowChainConfig[] = [];
  const candidates = [
    {
      chainId: Number(process.env.NEXT_PUBLIC_POLKADOT_CHAIN_ID || "420420417"),
      rpc: process.env.NEXT_PUBLIC_POLKADOT_RPC_URL || "https://eth-rpc-testnet.polkadot.io/",
      escrow: process.env.NEXT_PUBLIC_POLKADOT_MATCH_ESCROW_ADDRESS || "",
    },
    {
      chainId: Number(process.env.NEXT_PUBLIC_MOONBASE_CHAIN_ID || "1287"),
      rpc: process.env.NEXT_PUBLIC_MOONBASE_RPC_URL || "https://rpc.api.moonbase.moonbeam.network",
      escrow: process.env.NEXT_PUBLIC_MOONBASE_MATCH_ESCROW_ADDRESS || "",
    },
  ];

  for (const item of candidates) {
    if (!Number.isInteger(item.chainId) || item.chainId <= 0) continue;
    if (!/^https?:\/\//i.test(String(item.rpc))) continue;
    if (!/^0x[a-fA-F0-9]{40}$/.test(String(item.escrow))) continue;
    values.push({
      chainId: item.chainId,
      rpcUrl: String(item.rpc),
      escrowAddress: item.escrow as Address,
    });
  }
  return values;
}

function getEscrowChainConfig(chainIdRaw: number) {
  const chainId = Number(chainIdRaw);
  if (!Number.isInteger(chainId) || chainId <= 0) return null;
  return configuredEscrowChains().find((item) => item.chainId === chainId) ?? null;
}

function toEscrowMatchId(raw: string): bigint | null {
  const value = String(raw ?? "").trim();
  if (!/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function encodeEntryRoomCode(rawMatchId: string) {
  try {
    return encodeMatchCode(rawMatchId);
  } catch {
    return rawMatchId;
  }
}

async function readOnchainMatch(chainId: number, escrowMatchId: bigint) {
  const config = getEscrowChainConfig(chainId);
  if (!config) throw new Error("Unsupported chain or missing escrow config.");
  const client = createPublicClient({
    chain: undefined,
    transport: http(config.rpcUrl),
  });
  const row = (await client.readContract({
    address: config.escrowAddress,
    abi: escrowAbi,
    functionName: "getMatch",
    args: [escrowMatchId],
  })) as EscrowMatchData;
  const winner = (await client.readContract({
    address: config.escrowAddress,
    abi: escrowAbi,
    functionName: "resolvedWinner",
    args: [escrowMatchId],
  })) as Address;
  const statusRaw = row[4];
  const statusNum =
    typeof statusRaw === "bigint" ? Number(statusRaw) : typeof statusRaw === "number" ? statusRaw : 0;
  return {
    creator: row[0].toLowerCase(),
    opponent: row[1].toLowerCase(),
    stakeWei: row[2],
    statusNum,
    resolvedWinner: winner.toLowerCase(),
  };
}

function mapOnchainWinnerToTournamentMatch(
  tournamentMatch: TournamentMatch,
  onchain: { creator: string; opponent: string; resolvedWinner: string },
) {
  if (!tournamentMatch.awayWallet) return { ok: false as const, winner: null as string | null };
  const home = tournamentMatch.homeWallet.toLowerCase();
  const away = tournamentMatch.awayWallet.toLowerCase();
  const creator = onchain.creator.toLowerCase();
  const opponent = onchain.opponent.toLowerCase();
  const playersMatch =
    (creator === home && opponent === away) ||
    (creator === away && opponent === home);
  if (!playersMatch) return { ok: false as const, winner: null as string | null };
  if (onchain.resolvedWinner === zeroAddress) return { ok: true as const, winner: null as string | null };
  if (onchain.resolvedWinner === creator) return { ok: true as const, winner: creator === home ? home : away };
  if (onchain.resolvedWinner === opponent) return { ok: true as const, winner: opponent === home ? home : away };
  return { ok: false as const, winner: null as string | null };
}

function assertTournamentEntryStakeLock(
  onchain: { creator: string; opponent: string; statusNum: number; stakeWei: bigint },
  expectedWallet: string,
  expectedStakeWei: string,
) {
  const creator = onchain.creator.toLowerCase();
  const opponent = onchain.opponent.toLowerCase();
  if (creator !== expectedWallet.toLowerCase()) {
    throw new Error("Stake lock does not belong to this wallet.");
  }
  if (opponent !== zeroAddress) {
    throw new Error("Stake lock match must be open (opponent empty).");
  }
  if (onchain.statusNum !== 0) {
    throw new Error("Stake lock is no longer cancellable. Create a fresh lock.");
  }
  if (onchain.stakeWei.toString() !== expectedStakeWei) {
    throw new Error("Stake lock amount does not match tournament stake.");
  }
}

async function syncTournamentFromOnchain(detail: TournamentDetail): Promise<{ detail: TournamentDetail; changed: boolean }> {
  let working = detail;
  let changed = false;
  for (const match of sortMatches(working.matches)) {
    if (match.result !== "pending") continue;
    if (!match.awayWallet) continue;
    if (match.escrowChainId === null || !match.escrowMatchId) continue;
    const escrowMatchId = toEscrowMatchId(match.escrowMatchId);
    if (escrowMatchId === null) continue;
    try {
      const onchain = await readOnchainMatch(match.escrowChainId, escrowMatchId);
      if (onchain.statusNum !== 5) continue;
      const mapped = mapOnchainWinnerToTournamentMatch(match, onchain);
      if (!mapped.ok) continue;
      const next = resolveMatchFromWinner(working, match.id, mapped.winner);
      if (next !== working) {
        working = next;
        changed = true;
      }
    } catch {
      // ignore transient rpc failures
    }
  }
  return { detail: working, changed };
}

async function ensureStoreFile() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.writeFile(STORE_PATH, JSON.stringify({ byId: {} } satisfies DiskStore, null, 2), "utf8");
  }
}

async function readStore() {
  await ensureStoreFile();
  try {
    const parsed = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as Partial<DiskStore>;
    return { byId: parsed.byId ?? {} } satisfies DiskStore;
  } catch {
    return { byId: {} } satisfies DiskStore;
  }
}

async function writeStore(store: DiskStore) {
  await ensureStoreFile();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function mapSummaryRow(row: Record<string, unknown>): TournamentSummary {
  const chainId = Number(row.stake_chain_id ?? defaultStakeChainId());
  const stakeWei = (() => {
    try {
      return normalizeStakeWei(row.stake_wei ?? "1");
    } catch {
      return "1";
    }
  })();
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    game: String(row.game ?? ""),
    platform: String(row.platform ?? ""),
    size: Number(row.size ?? 0),
    timeframeMins: Number(row.timeframe_mins ?? 0),
    format: normalizeFormat(row.format),
    pointsTarget: toNullableNumber(row.points_target),
    stakeWei,
    stakeChainId: Number.isInteger(chainId) && chainId > 0 ? chainId : defaultStakeChainId(),
    status: normalizeStatus(row.status),
    createdByWallet: String(row.created_by_wallet ?? "").toLowerCase(),
    createdByUsername: String(row.created_by_username ?? ""),
    createdAt: toEpoch(row.created_at),
    updatedAt: toEpoch(row.updated_at),
    participantCount: Number(row.participant_count ?? 0),
  };
}

function mapEntryRow(row: Record<string, unknown>): TournamentEntry {
  const escrowMatchId = toNullableString(row.stake_escrow_match_id);
  return {
    id: String(row.id ?? ""),
    tournamentId: String(row.tournament_id ?? ""),
    wallet: String(row.wallet ?? "").toLowerCase(),
    username: String(row.username ?? ""),
    joinedAt: toEpoch(row.joined_at),
    played: Number(row.played ?? 0),
    wins: Number(row.wins ?? 0),
    draws: Number(row.draws ?? 0),
    losses: Number(row.losses ?? 0),
    points: Number(row.points ?? 0),
    stakeLocked: toBoolean(row.stake_locked),
    stakeChainId: toNullableNumber(row.stake_chain_id),
    stakeEscrowMatchId: escrowMatchId,
    stakeEscrowRoomCode: escrowMatchId ? encodeEntryRoomCode(escrowMatchId) : null,
    stakeLockedAt: toNullableNumber(row.stake_locked_at),
  };
}

function mapMatchRow(row: Record<string, unknown>): TournamentMatch {
  return {
    id: String(row.id ?? ""),
    tournamentId: String(row.tournament_id ?? ""),
    roundNo: Number(row.round_no ?? 1),
    homeWallet: String(row.home_wallet ?? "").toLowerCase(),
    awayWallet: row.away_wallet ? String(row.away_wallet).toLowerCase() : null,
    homeUsername: String(row.home_username ?? ""),
    awayUsername: row.away_username ? String(row.away_username) : null,
    homeScore: toNullableNumber(row.home_score),
    awayScore: toNullableNumber(row.away_score),
    result: normalizeResult(row.result),
    winnerWallet: row.winner_wallet ? String(row.winner_wallet).toLowerCase() : null,
    escrowChainId: toNullableNumber(row.escrow_chain_id),
    escrowMatchId: toNullableString(row.escrow_match_id),
    escrowRoomCode: toNullableString(row.escrow_room_code),
    createdAt: toEpoch(row.created_at),
    updatedAt: toEpoch(row.updated_at),
  };
}

function normalizePersistedEntry(
  entry: TournamentEntry,
  tournamentId: string,
  fallbackStakeChainId: number,
) {
  const stakeMatchId = entry.stakeEscrowMatchId ? String(entry.stakeEscrowMatchId) : null;
  return {
    ...entry,
    tournamentId,
    stakeLocked: typeof entry.stakeLocked === "boolean" ? entry.stakeLocked : true,
    stakeChainId:
      typeof entry.stakeChainId === "number" && Number.isInteger(entry.stakeChainId) && entry.stakeChainId > 0
        ? entry.stakeChainId
        : fallbackStakeChainId,
    stakeEscrowMatchId: stakeMatchId,
    stakeEscrowRoomCode: stakeMatchId ? encodeEntryRoomCode(stakeMatchId) : null,
    stakeLockedAt:
      typeof entry.stakeLockedAt === "number" && Number.isFinite(entry.stakeLockedAt)
        ? entry.stakeLockedAt
        : entry.joinedAt,
    points: Number.isFinite(entry.points) ? entry.points : 0,
    played: Number.isFinite(entry.played) ? entry.played : 0,
    wins: Number.isFinite(entry.wins) ? entry.wins : 0,
    draws: Number.isFinite(entry.draws) ? entry.draws : 0,
    losses: Number.isFinite(entry.losses) ? entry.losses : 0,
  };
}

function normalizePersistedDetail(detail: TournamentDetail): TournamentDetail {
  const stakeWei = (() => {
    try {
      return normalizeStakeWei((detail as { stakeWei?: unknown }).stakeWei ?? "1");
    } catch {
      return "1";
    }
  })();
  const chainId =
    typeof (detail as { stakeChainId?: unknown }).stakeChainId === "number" &&
    Number.isInteger((detail as { stakeChainId?: unknown }).stakeChainId) &&
    Number((detail as { stakeChainId?: unknown }).stakeChainId) > 0
      ? Number((detail as { stakeChainId?: unknown }).stakeChainId)
      : defaultStakeChainId();
  const entries = sortEntries(
    detail.entries.map((entry) => normalizePersistedEntry(entry, detail.id, chainId)),
  );
  return {
    ...detail,
    stakeWei,
    stakeChainId: chainId,
    entries,
    participantCount: entries.length,
  };
}

async function listDb(limit: number): Promise<TournamentSummary[]> {
  await ensureDatabaseSchema();
  const db = getDatabase();
  const rows = await db`
    SELECT t.*, COALESCE(COUNT(e.id), 0) AS participant_count
    FROM tournaments t
    LEFT JOIN tournament_entries e ON e.tournament_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => mapSummaryRow(row as Record<string, unknown>));
}

async function getDb(id: string): Promise<TournamentDetail | null> {
  await ensureDatabaseSchema();
  const db = getDatabase();
  const summaryRows = await db`
    SELECT t.*, COALESCE(COUNT(e.id), 0) AS participant_count
    FROM tournaments t
    LEFT JOIN tournament_entries e ON e.tournament_id = t.id
    WHERE t.id = ${id}
    GROUP BY t.id
    LIMIT 1
  `;
  if (!summaryRows.length) return null;
  const entryRows = await db`SELECT * FROM tournament_entries WHERE tournament_id = ${id}`;
  const matchRows = await db`SELECT * FROM tournament_matches WHERE tournament_id = ${id}`;
  const summary = mapSummaryRow(summaryRows[0] as Record<string, unknown>);
  return normalizePersistedDetail({
    ...summary,
    entries: sortEntries(entryRows.map((row) => mapEntryRow(row as Record<string, unknown>))),
    matches: sortMatches(matchRows.map((row) => mapMatchRow(row as Record<string, unknown>))),
  });
}

async function saveDb(detail: TournamentDetail) {
  await ensureDatabaseSchema();
  const db = getDatabase();
  await db`
    INSERT INTO tournaments (
      id, title, game, platform, size, timeframe_mins, format, points_target, stake_wei, stake_chain_id, status,
      created_by_wallet, created_by_username, created_at, updated_at
    ) VALUES (
      ${detail.id}, ${detail.title}, ${detail.game}, ${detail.platform}, ${detail.size},
      ${detail.timeframeMins}, ${detail.format}, ${detail.pointsTarget}, ${detail.stakeWei}, ${detail.stakeChainId}, ${detail.status},
      ${detail.createdByWallet}, ${detail.createdByUsername}, ${detail.createdAt}, ${Date.now()}
    )
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      game = EXCLUDED.game,
      platform = EXCLUDED.platform,
      size = EXCLUDED.size,
      timeframe_mins = EXCLUDED.timeframe_mins,
      format = EXCLUDED.format,
      points_target = EXCLUDED.points_target,
      stake_wei = EXCLUDED.stake_wei,
      stake_chain_id = EXCLUDED.stake_chain_id,
      status = EXCLUDED.status,
      created_by_wallet = EXCLUDED.created_by_wallet,
      created_by_username = EXCLUDED.created_by_username,
      updated_at = EXCLUDED.updated_at
  `;
  await db`DELETE FROM tournament_entries WHERE tournament_id = ${detail.id}`;
  for (const entry of detail.entries) {
    await db`
      INSERT INTO tournament_entries (
        id, tournament_id, wallet, username, joined_at, played, wins, draws, losses, points,
        stake_locked, stake_chain_id, stake_escrow_match_id, stake_locked_at
      )
      VALUES (
        ${entry.id}, ${detail.id}, ${entry.wallet}, ${entry.username}, ${entry.joinedAt},
        ${entry.played}, ${entry.wins}, ${entry.draws}, ${entry.losses}, ${entry.points},
        ${entry.stakeLocked}, ${entry.stakeChainId}, ${entry.stakeEscrowMatchId}, ${entry.stakeLockedAt}
      )
    `;
  }
  await db`DELETE FROM tournament_matches WHERE tournament_id = ${detail.id}`;
  for (const match of detail.matches) {
    await db`
      INSERT INTO tournament_matches (
        id, tournament_id, round_no, home_wallet, away_wallet, home_username, away_username,
        home_score, away_score, result, winner_wallet, escrow_chain_id, escrow_match_id, escrow_room_code, created_at, updated_at
      ) VALUES (
        ${match.id}, ${detail.id}, ${match.roundNo}, ${match.homeWallet}, ${match.awayWallet},
        ${match.homeUsername}, ${match.awayUsername}, ${match.homeScore}, ${match.awayScore},
        ${match.result}, ${match.winnerWallet}, ${match.escrowChainId}, ${match.escrowMatchId}, ${match.escrowRoomCode}, ${match.createdAt}, ${match.updatedAt}
      )
    `;
  }
}

async function listFile(limit: number) {
  const store = await readStore();
  return Object.values(store.byId)
    .map((detail) => normalizePersistedDetail(detail))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

async function getFile(id: string) {
  const store = await readStore();
  const detail = store.byId[id] ?? null;
  return detail ? normalizePersistedDetail(detail) : null;
}

async function saveFile(detail: TournamentDetail) {
  const store = await readStore();
  store.byId[detail.id] = normalizePersistedDetail(detail);
  await writeStore(store);
}

async function deleteFile(id: string) {
  const store = await readStore();
  delete store.byId[id];
  await writeStore(store);
}

async function listBackend(limit: number) {
  if (isDatabaseConfigured()) {
    try { return await listDb(limit); } catch (error) { if (!isRecoverableBackendError(error)) throw error; }
  }
  return listFile(limit);
}

async function getBackend(id: string) {
  if (isDatabaseConfigured()) {
    try { return await getDb(id); } catch (error) { if (!isRecoverableBackendError(error)) throw error; }
  }
  return getFile(id);
}

async function saveBackend(detail: TournamentDetail) {
  if (isDatabaseConfigured()) {
    try { await saveDb(detail); return; } catch (error) { if (!isRecoverableBackendError(error)) throw error; }
  }
  await saveFile(detail);
}

async function deleteBackend(id: string) {
  if (isDatabaseConfigured()) {
    try {
      await ensureDatabaseSchema();
      const db = getDatabase();
      await db`DELETE FROM tournament_matches WHERE tournament_id = ${id}`;
      await db`DELETE FROM tournament_entries WHERE tournament_id = ${id}`;
      await db`DELETE FROM tournaments WHERE id = ${id}`;
      return;
    } catch (error) {
      if (!isRecoverableBackendError(error)) throw error;
    }
  }
  await deleteFile(id);
}

export async function listTournaments(limit = 30): Promise<TournamentSummary[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 30)));
  return listBackend(safeLimit);
}

export async function getTournamentById(idRaw: string): Promise<TournamentDetail | null> {
  const id = normalizeId(idRaw);
  if (!id) return null;
  const detail = await getBackend(id);
  if (!detail) return null;
  const synced = await syncTournamentFromOnchain(detail);
  if (synced.changed) {
    await saveBackend(synced.detail);
  }
  return synced.detail;
}

export async function createTournament(payload: CreateTournamentPayload): Promise<TournamentDetail> {
  const input = validateCreatePayload(payload);
  const creatorStakeMatchId = toEscrowMatchId(input.creatorStakeEscrowMatchId);
  if (creatorStakeMatchId === null) throw new Error("Invalid creator stake lock id.");
  const onchainStake = await readOnchainMatch(input.stakeChainId, creatorStakeMatchId);
  assertTournamentEntryStakeLock(onchainStake, input.creatorWallet, input.stakeWei);

  let id = "";
  for (let i = 0; i < 12; i += 1) {
    const candidate = generateCode();
    const existing = await getBackend(candidate);
    if (!existing) {
      id = candidate;
      break;
    }
  }
  if (!id) throw new Error("Failed to allocate tournament code. Try again.");
  const now = Date.now();
  const detail: TournamentDetail = {
    id,
    title: input.title,
    game: input.game,
    platform: input.platform,
    size: input.size,
    timeframeMins: input.timeframeMins,
    format: input.format,
    pointsTarget: input.pointsTarget,
    stakeWei: input.stakeWei,
    stakeChainId: input.stakeChainId,
    status: "open",
    createdByWallet: input.creatorWallet,
    createdByUsername: input.creatorUsername,
    createdAt: now,
    updatedAt: now,
    participantCount: 1,
    entries: [{
      id: `${id}:${input.creatorWallet}`,
      tournamentId: id,
      wallet: input.creatorWallet,
      username: input.creatorUsername,
      joinedAt: now,
      played: 0, wins: 0, draws: 0, losses: 0, points: 0,
      stakeLocked: true,
      stakeChainId: input.stakeChainId,
      stakeEscrowMatchId: creatorStakeMatchId.toString(),
      stakeEscrowRoomCode: encodeEntryRoomCode(creatorStakeMatchId.toString()),
      stakeLockedAt: now,
    }],
    matches: [],
  };
  await saveBackend(detail);
  return detail;
}

export async function joinTournament(
  tournamentIdRaw: string,
  walletRaw: string,
  usernameRaw: string,
  stakeEscrowMatchIdRaw: string,
  stakeChainIdRaw: number,
) {
  const id = normalizeId(tournamentIdRaw);
  const wallet = normalizeWallet(walletRaw);
  const username = sanitizeText(usernameRaw);
  const stakeEscrowMatchId = String(stakeEscrowMatchIdRaw ?? "").trim();
  const stakeChainId = Number(stakeChainIdRaw);
  validateWallet(wallet);
  if (username.length < 3 || username.length > 24) throw new Error("Username must be 3-24 characters.");
  const detail = await getBackend(id);
  if (!detail) throw new Error("Tournament not found.");
  if (detail.status === "completed") throw new Error("Tournament already completed.");
  if (detail.status === "in_progress") throw new Error("Tournament already started.");
  if (detail.entries.some((entry) => entry.wallet === wallet)) return detail;
  if (detail.entries.length >= detail.size) throw new Error("Tournament is already full.");
  if (stakeChainId !== detail.stakeChainId) throw new Error("Stake lock chain does not match tournament chain.");
  const stakeMatchId = toEscrowMatchId(stakeEscrowMatchId);
  if (stakeMatchId === null) throw new Error("Invalid stake lock id.");
  const onchainStake = await readOnchainMatch(stakeChainId, stakeMatchId);
  assertTournamentEntryStakeLock(onchainStake, wallet, detail.stakeWei);

  const now = Date.now();
  detail.entries.push({
    id: `${id}:${wallet}`,
    tournamentId: id,
    wallet,
    username,
    joinedAt: now,
    played: 0, wins: 0, draws: 0, losses: 0, points: 0,
    stakeLocked: true,
    stakeChainId: stakeChainId,
    stakeEscrowMatchId: stakeMatchId.toString(),
    stakeEscrowRoomCode: encodeEntryRoomCode(stakeMatchId.toString()),
    stakeLockedAt: now,
  });
  detail.entries = sortEntries(detail.entries);
  detail.participantCount = detail.entries.length;
  detail.status = detail.entries.length >= detail.size ? "full" : "open";
  detail.updatedAt = Date.now();
  const bootstrapped = applyBootstrap(detail);
  await saveBackend(bootstrapped);
  return bootstrapped;
}

export async function bootstrapTournamentIfReady(tournamentIdRaw: string) {
  const id = normalizeId(tournamentIdRaw);
  const detail = await getBackend(id);
  if (!detail) throw new Error("Tournament not found.");
  const next = applyBootstrap(detail);
  await saveBackend(next);
  return next;
}

export async function exitTournament(tournamentIdRaw: string, walletRaw: string) {
  const id = normalizeId(tournamentIdRaw);
  const wallet = normalizeWallet(walletRaw);
  validateWallet(wallet);
  const detail = await getBackend(id);
  if (!detail) throw new Error("Tournament not found.");
  if (detail.status === "in_progress" || detail.status === "completed") {
    throw new Error("Tournament already started. Exit is disabled.");
  }
  if (detail.matches.length > 0) {
    throw new Error("Tournament already bootstrapped. Exit is disabled.");
  }
  if (wallet === detail.createdByWallet) {
    throw new Error("Host should delete the tournament instead of exit.");
  }
  const existing = detail.entries.find((entry) => entry.wallet === wallet);
  if (!existing) throw new Error("You are not in this tournament.");

  detail.entries = detail.entries.filter((entry) => entry.wallet !== wallet);
  detail.entries = sortEntries(detail.entries);
  detail.participantCount = detail.entries.length;
  detail.status = detail.entries.length >= detail.size ? "full" : "open";
  detail.updatedAt = Date.now();
  await saveBackend(detail);
  return detail;
}

export async function deleteTournament(tournamentIdRaw: string, hostWalletRaw: string) {
  const id = normalizeId(tournamentIdRaw);
  const hostWallet = normalizeWallet(hostWalletRaw);
  validateWallet(hostWallet);
  const detail = await getBackend(id);
  if (!detail) throw new Error("Tournament not found.");
  if (detail.createdByWallet !== hostWallet) throw new Error("Only host can delete this tournament.");
  if (detail.status === "in_progress" || detail.status === "completed") {
    throw new Error("Tournament already started. Delete is disabled.");
  }
  if (detail.matches.length > 0) {
    throw new Error("Tournament already bootstrapped. Delete is disabled.");
  }
  if (detail.entries.some((entry) => entry.wallet !== detail.createdByWallet)) {
    throw new Error("Other players already joined. Ask them to exit first.");
  }
  await deleteBackend(detail.id);
  return { id: detail.id, deleted: true as const };
}

export async function linkTournamentMatchEscrow(
  tournamentIdRaw: string,
  tournamentMatchIdRaw: string,
  payload: LinkEscrowPayload,
) {
  const id = normalizeId(tournamentIdRaw);
  const tournamentMatchId = normalizeId(tournamentMatchIdRaw);
  if (!id || !tournamentMatchId) throw new Error("Invalid tournament or match id.");

  const detail = await getBackend(id);
  if (!detail) throw new Error("Tournament not found.");
  if (detail.status === "completed") throw new Error("Tournament already completed.");

  const localMatch = detail.matches.find((item) => item.id === tournamentMatchId);
  if (!localMatch) throw new Error("Tournament match not found.");
  if (localMatch.result !== "pending") throw new Error("Tournament match already resolved.");
  if (!localMatch.awayWallet) throw new Error("Bye match does not need escrow linking.");

  const linker = normalizeWallet(payload.linkerWallet ?? "");
  if (linker) {
    validateWallet(linker);
    const canLink =
      linker === detail.createdByWallet ||
      linker === localMatch.homeWallet.toLowerCase() ||
      linker === localMatch.awayWallet.toLowerCase();
    if (!canLink) throw new Error("Only host or matched players can link this fixture.");
  }

  const chainId = Number(payload.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("Invalid chain id.");
  if (!getEscrowChainConfig(chainId)) throw new Error("Chain not configured for tournament escrow sync.");

  const roomCode = String(payload.roomCode ?? "").trim();
  const decoded = decodeMatchCode(roomCode);
  if (decoded === null || decoded < 0n) throw new Error("Invalid room code.");
  const normalizedRoomCode = /^\d{6}$/.test(roomCode) ? roomCode : (() => {
    try {
      return encodeMatchCode(decoded);
    } catch {
      return roomCode;
    }
  })();

  const onchain = await readOnchainMatch(chainId, decoded);
  const mapped = mapOnchainWinnerToTournamentMatch(localMatch, onchain);
  if (!mapped.ok) throw new Error("On-chain match players do not match this tournament fixture.");

  localMatch.escrowChainId = chainId;
  localMatch.escrowMatchId = decoded.toString();
  localMatch.escrowRoomCode = normalizedRoomCode;
  localMatch.updatedAt = Date.now();

  let next = { ...detail, matches: [...detail.matches], updatedAt: Date.now() };
  if (onchain.statusNum === 5) {
    next = resolveMatchFromWinner(next, localMatch.id, mapped.winner);
  }
  const synced = await syncTournamentFromOnchain(next);
  await saveBackend(synced.detail);
  return synced.detail;
}

export async function reportTournamentMatchResult() {
  throw new Error("Manual score reporting is disabled. Link an on-chain match room.");
}
