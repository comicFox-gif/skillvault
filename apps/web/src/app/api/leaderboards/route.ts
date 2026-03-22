import { NextResponse } from "next/server";
import { isDatabaseConfigured, getDatabase, ensureDatabaseSchema } from "@/lib/server/db";
import { checkRateLimit } from "@/lib/server/rateLimit";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

type LeaderboardPlayer = {
  wallet: string;
  username: string | null;
  avatarDataUrl: string | null;
  wins: number;
  losses: number;
  disputes: number;
  rank: number;
};

export async function GET(request: Request) {
  try {
    const limit = checkRateLimit({
      request,
      key: "leaderboards:get",
      max: 30,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many requests. Retry in ${limit.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }

    const url = new URL(request.url);
    const chainIdRaw = url.searchParams.get("chainId");
    if (!chainIdRaw) {
      return NextResponse.json({ error: "chainId is required." }, { status: 400 });
    }
    const chainId = Number(chainIdRaw);
    if (!Number.isFinite(chainId) || chainId <= 0) {
      return NextResponse.json({ error: "Invalid chainId." }, { status: 400 });
    }

    const limitParam = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const offsetParam = Math.max(0, Number(url.searchParams.get("offset")) || 0);

    if (isDatabaseConfigured()) {
      await ensureDatabaseSchema();
      const sql = getDatabase();

      const countResult = await sql`
        SELECT COUNT(*)::int AS total
        FROM wallet_reputation_cache
        WHERE chain_id = ${chainId}
      `;
      const total = countResult[0]?.total ?? 0;

      const rows = await sql`
        SELECT
          r.wallet,
          r.wins,
          r.losses,
          r.disputes,
          p.username,
          p.avatar_data_url
        FROM wallet_reputation_cache r
        LEFT JOIN wallet_profiles p ON LOWER(r.wallet) = LOWER(p.wallet)
        WHERE r.chain_id = ${chainId}
        ORDER BY r.wins DESC, r.losses ASC
        LIMIT ${limitParam}
        OFFSET ${offsetParam}
      `;

      const players: LeaderboardPlayer[] = rows.map((row, index) => ({
        wallet: row.wallet,
        username: row.username ?? null,
        avatarDataUrl: row.avatar_data_url ?? null,
        wins: Number(row.wins),
        losses: Number(row.losses),
        disputes: Number(row.disputes),
        rank: offsetParam + index + 1,
      }));

      return NextResponse.json({ players, total });
    }

    // JSON file fallback
    const fallbackPath = path.join(process.cwd(), "..", "..", "data", "leaderboards-cache.json");
    try {
      const raw = await fs.readFile(fallbackPath, "utf-8");
      const data = JSON.parse(raw) as Record<
        string,
        Array<{
          wallet: string;
          wins: number;
          losses: number;
          disputes: number;
          username?: string;
          avatarDataUrl?: string;
        }>
      >;
      const chainKey = String(chainId);
      const all = (data[chainKey] ?? []).sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return a.losses - b.losses;
      });
      const total = all.length;
      const slice = all.slice(offsetParam, offsetParam + limitParam);
      const players: LeaderboardPlayer[] = slice.map((entry, index) => ({
        wallet: entry.wallet,
        username: entry.username ?? null,
        avatarDataUrl: entry.avatarDataUrl ?? null,
        wins: entry.wins,
        losses: entry.losses,
        disputes: entry.disputes,
        rank: offsetParam + index + 1,
      }));
      return NextResponse.json({ players, total });
    } catch {
      return NextResponse.json({ players: [], total: 0 });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch leaderboards." },
      { status: 500 },
    );
  }
}
