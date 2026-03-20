import { NextResponse } from "next/server";
import { sendPushToWallets } from "@/lib/server/push";

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
    const payload = (await request.json().catch(() => ({}))) as {
      wallets?: string[];
      title?: string;
      body?: string;
      url?: string;
      tag?: string;
      data?: Record<string, unknown>;
    };

    const wallets = Array.isArray(payload.wallets) ? payload.wallets.map((wallet) => String(wallet ?? "")) : [];
    if (!wallets.length) {
      return NextResponse.json({ error: "wallets are required." }, { status: 400 });
    }

    const title = String(payload.title ?? "").trim();
    const body = String(payload.body ?? "").trim();
    if (!title || !body) {
      return NextResponse.json({ error: "title and body are required." }, { status: 400 });
    }

    const result = await sendPushToWallets(wallets, {
      title,
      body,
      url: payload.url ? String(payload.url) : undefined,
      tag: payload.tag ? String(payload.tag) : undefined,
      data: payload.data ?? {},
    });

    return NextResponse.json({ ok: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to send notifications.") },
      { status: 400 },
    );
  }
}
