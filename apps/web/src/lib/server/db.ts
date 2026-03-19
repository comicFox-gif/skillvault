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
  })();
  await schemaInitPromise;
}
