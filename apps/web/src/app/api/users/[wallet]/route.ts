import { NextResponse } from "next/server";
import { getWalletProfile, setWalletProfile } from "@/lib/server/profileStore";
import { checkRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

type ParamsContext = {
  params: Promise<{ wallet: string }> | { wallet: string };
};

async function getWalletParam(context: ParamsContext) {
  const params = await Promise.resolve(context.params);
  return String(params.wallet ?? "").trim().toLowerCase();
}

export async function GET(_request: Request, context: ParamsContext) {
  try {
    const wallet = await getWalletParam(context);
    if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
    const profile = await getWalletProfile(wallet);
    return NextResponse.json({ profile });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load profile") }, { status: 500 });
  }
}

export async function POST(request: Request, context: ParamsContext) {
  try {
    const wallet = await getWalletParam(context);
    if (!wallet) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
    const limit = checkRateLimit({
      request,
      key: `users:${wallet}:profile:update`,
      max: 10,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many profile updates. Retry in ${limit.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }
    const body = (await request.json().catch(() => ({}))) as { username?: string; avatarDataUrl?: string };
    const profile = await setWalletProfile(wallet, {
      username: typeof body.username === "string" ? body.username : undefined,
      avatarDataUrl: typeof body.avatarDataUrl === "string" ? body.avatarDataUrl : undefined,
    });
    return NextResponse.json({ profile }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to save profile") }, { status: 400 });
  }
}
