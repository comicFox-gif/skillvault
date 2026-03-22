import { NextResponse } from "next/server";
import { getReferralsByWallet } from "@/lib/server/referralStore";
import { checkRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

function normalizeAddress(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET(request: Request) {
  try {
    const limit = checkRateLimit({
      request,
      key: "referrals:stats",
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
    const walletRaw = url.searchParams.get("wallet");
    if (!walletRaw) {
      return NextResponse.json({ error: "wallet is required." }, { status: 400 });
    }

    const wallet = normalizeAddress(walletRaw);
    if (!wallet) {
      return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    }

    const referrals = await getReferralsByWallet(wallet);

    const totalReferrals = referrals.length;
    const claimedReferrals = referrals.filter((r) => r.claimedAt != null).length;
    const pendingReferrals = totalReferrals - claimedReferrals;
    const totalMatchesCreated = referrals.reduce((sum, r) => sum + r.matchesCreated, 0);
    const totalMatchesJoined = referrals.reduce((sum, r) => sum + r.matchesJoined, 0);
    const totalMatchesFromReferrals = totalMatchesCreated + totalMatchesJoined;

    return NextResponse.json({
      wallet,
      totalReferrals,
      claimedReferrals,
      pendingReferrals,
      totalMatchesCreated,
      totalMatchesJoined,
      totalMatchesFromReferrals,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch referral stats." },
      { status: 500 },
    );
  }
}
