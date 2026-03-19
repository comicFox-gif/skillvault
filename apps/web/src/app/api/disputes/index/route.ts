import { NextResponse } from "next/server";
import { listKnownDisputeMatchIds } from "@/lib/server/disputeStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ids = await listKnownDisputeMatchIds();
    return NextResponse.json({ ids });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load disputes index" }, { status: 500 });
  }
}