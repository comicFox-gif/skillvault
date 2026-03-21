import { NextResponse } from "next/server";
import { upsertPushSubscription } from "@/lib/server/notificationStore";
import { checkRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export async function POST(request: Request) {
  try {
    const limit = checkRateLimit({
      request,
      key: "notifications:subscribe:post",
      max: 20,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many subscribe requests. Retry in ${limit.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }

    const payload = (await request.json().catch(() => ({}))) as {
      wallet?: string;
      subscription?: {
        endpoint?: string;
        keys?: {
          p256dh?: string;
          auth?: string;
        };
      };
      userAgent?: string;
    };

    const wallet = String(payload.wallet ?? "").trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: "Invalid wallet." }, { status: 400 });
    }

    const item = await upsertPushSubscription(wallet, payload.subscription ?? {}, payload.userAgent);
    return NextResponse.json({ ok: true, item });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to save push subscription.") },
      { status: 400 },
    );
  }
}
