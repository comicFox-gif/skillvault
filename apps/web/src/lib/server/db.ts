import postgres, { type Sql } from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __skillvault_sql__: Sql | undefined;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const useSsl = databaseUrl ? !/localhost|127\.0\.0\.1/i.test(databaseUrl) : false;

function createClient(connectionString: string) {
  return postgres(connectionString, {
    ssl: useSsl ? "require" : undefined,
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
  });
}

const sql = databaseUrl
  ? (globalThis.__skillvault_sql__ ??= createClient(databaseUrl))
  : null;

let schemaInitPromise: Promise<void> | null = null;

export function isDatabaseConfigured() {
  return Boolean(sql);
}

export function getDatabase() {
  if (!sql) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return sql;
}

export async function ensureDatabaseSchema() {
  if (!sql) return;
  if (schemaInitPromise) {
    await schemaInitPromise;
    return;
  }
  schemaInitPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS dispute_messages (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL,
        sender_role TEXT NOT NULL,
        sender_address TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS dispute_messages_match_created_idx
      ON dispute_messages (match_id, created_at)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS dispute_evidence (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL,
        uploader TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        note TEXT NOT NULL,
        attachment_name TEXT NOT NULL,
        attachment_size_bytes INTEGER NOT NULL,
        attachment_mime_type TEXT NOT NULL,
        image_data_url TEXT NOT NULL
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS dispute_evidence_match_created_idx
      ON dispute_evidence (match_id, created_at)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS wallet_reputation_cache (
        chain_id INTEGER NOT NULL,
        wallet TEXT NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        resolved INTEGER NOT NULL DEFAULT 0,
        disputes INTEGER NOT NULL DEFAULT 0,
        no_response_flags INTEGER NOT NULL DEFAULT 0,
        entries_json TEXT NOT NULL DEFAULT '[]',
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (chain_id, wallet)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS wallet_reputation_cache_updated_idx
      ON wallet_reputation_cache (updated_at)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS rematch_intents (
        old_match_id TEXT PRIMARY KEY,
        new_match_id TEXT NOT NULL,
        new_room_code TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        requested_by_role TEXT NOT NULL,
        creator TEXT NOT NULL,
        opponent TEXT NOT NULL,
        stake TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        join_mins TEXT NOT NULL,
        game TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        joined_by TEXT,
        cancelled_by TEXT
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS rematch_intents_updated_idx
      ON rematch_intents (updated_at)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS wallet_profiles (
        wallet TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        avatar_data_url TEXT,
        updated_at BIGINT NOT NULL
      )
    `;
    await sql`
      ALTER TABLE wallet_profiles
      ADD COLUMN IF NOT EXISTS avatar_data_url TEXT
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS wallet_profiles_updated_idx
      ON wallet_profiles (updated_at)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        last_success_at BIGINT,
        last_error TEXT
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS push_subscriptions_wallet_idx
      ON push_subscriptions (wallet, updated_at DESC)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS tournaments (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        game TEXT NOT NULL,
        platform TEXT NOT NULL,
        size INTEGER NOT NULL,
        timeframe_mins INTEGER NOT NULL,
        format TEXT NOT NULL DEFAULT 'bracket',
        points_target INTEGER,
        stake_wei TEXT NOT NULL DEFAULT '1',
        stake_chain_id INTEGER NOT NULL DEFAULT 420420417,
        status TEXT NOT NULL,
        created_by_wallet TEXT NOT NULL,
        created_by_username TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `;
    await sql`
      ALTER TABLE tournaments
      ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'bracket'
    `;
    await sql`
      ALTER TABLE tournaments
      ADD COLUMN IF NOT EXISTS points_target INTEGER
    `;
    await sql`
      ALTER TABLE tournaments
      ADD COLUMN IF NOT EXISTS stake_wei TEXT NOT NULL DEFAULT '1'
    `;
    await sql`
      ALTER TABLE tournaments
      ADD COLUMN IF NOT EXISTS stake_chain_id INTEGER NOT NULL DEFAULT 420420417
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS tournaments_created_idx
      ON tournaments (created_at DESC)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS tournaments_status_idx
      ON tournaments (status, updated_at DESC)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS tournament_entries (
        id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL,
        wallet TEXT NOT NULL,
        username TEXT NOT NULL,
        joined_at BIGINT NOT NULL,
        played INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        draws INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        points INTEGER NOT NULL DEFAULT 0,
        stake_locked BOOLEAN NOT NULL DEFAULT TRUE,
        stake_chain_id INTEGER,
        stake_escrow_match_id TEXT,
        stake_locked_at BIGINT
      )
    `;
    await sql`
      ALTER TABLE tournament_entries
      ADD COLUMN IF NOT EXISTS played INTEGER NOT NULL DEFAULT 0
    `;
    await sql`
      ALTER TABLE tournament_entries
      ADD COLUMN IF NOT EXISTS draws INTEGER NOT NULL DEFAULT 0
    `;
    await sql`
      ALTER TABLE tournament_entries
      ADD COLUMN IF NOT EXISTS stake_locked BOOLEAN NOT NULL DEFAULT TRUE
    `;
    await sql`
      ALTER TABLE tournament_entries
      ADD COLUMN IF NOT EXISTS stake_chain_id INTEGER
    `;
    await sql`
      ALTER TABLE tournament_entries
      ADD COLUMN IF NOT EXISTS stake_escrow_match_id TEXT
    `;
    await sql`
      ALTER TABLE tournament_entries
      ADD COLUMN IF NOT EXISTS stake_locked_at BIGINT
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS tournament_entries_tournament_wallet_uidx
      ON tournament_entries (tournament_id, wallet)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS tournament_entries_tournament_joined_idx
      ON tournament_entries (tournament_id, joined_at ASC)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS tournament_matches (
        id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL,
        round_no INTEGER NOT NULL,
        home_wallet TEXT NOT NULL,
        away_wallet TEXT,
        home_username TEXT NOT NULL,
        away_username TEXT,
        home_score INTEGER,
        away_score INTEGER,
        result TEXT NOT NULL,
        winner_wallet TEXT,
        escrow_chain_id INTEGER,
        escrow_match_id TEXT,
        escrow_room_code TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `;
    await sql`
      ALTER TABLE tournament_matches
      ADD COLUMN IF NOT EXISTS escrow_chain_id INTEGER
    `;
    await sql`
      ALTER TABLE tournament_matches
      ADD COLUMN IF NOT EXISTS escrow_match_id TEXT
    `;
    await sql`
      ALTER TABLE tournament_matches
      ADD COLUMN IF NOT EXISTS escrow_room_code TEXT
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS tournament_matches_tournament_round_idx
      ON tournament_matches (tournament_id, round_no, created_at)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS tournament_matches_tournament_result_idx
      ON tournament_matches (tournament_id, result, updated_at)
    `;
  })();
  await schemaInitPromise;
}
