import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export async function POST() {
  try {
    return NextResponse.json(
      { error: "Manual score entry is disabled. Link on-chain match instead." },
      { status: 410 },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to save match result") },
      { status: 400 },
    );
  }
}
