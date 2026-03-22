import { NextResponse } from "next/server";
import {
  generateReferralCode,
  getReferralsByWallet,
  claimReferral,
} from "@/lib/server/referralStore";
import { checkRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

function normalizeAddress(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET(request: Request) {
  try {
    const limit = checkRateLimit({
      request,
      key: "referrals:get",
      max: 20,
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

    let referrals = await getReferralsByWallet(wallet);

    // Auto-generate a referral code if none exists yet
    if (referrals.length === 0) {
      await generateReferralCode(wallet);
      referrals = await getReferralsByWallet(wallet);
    }

    return NextResponse.json({ referrals });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch referrals." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const limit = checkRateLimit({
      request,
      key: "referrals:post",
      max: 20,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many requests. Retry in ${limit.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }

    const payload = (await request.json()) as {
      action?: string;
      code?: string;
      wallet?: string;
    };

    if (!payload || !payload.action || !payload.code || !payload.wallet) {
      return NextResponse.json(
        { error: "action, code, and wallet are required." },
        { status: 400 },
      );
    }

    if (payload.action !== "claim") {
      return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    }

    const wallet = normalizeAddress(payload.wallet);
    const code = String(payload.code ?? "").trim().toUpperCase();

    if (!wallet || !code) {
      return NextResponse.json({ error: "Invalid wallet or code." }, { status: 400 });
    }

    const referral = await claimReferral(code, wallet);
    if (!referral) {
      return NextResponse.json(
        { error: "Referral code not found, already claimed, or cannot self-refer." },
        { status: 400 },
      );
    }

    return NextResponse.json({ referral });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to claim referral." },
      { status: 500 },
    );
  }
}
