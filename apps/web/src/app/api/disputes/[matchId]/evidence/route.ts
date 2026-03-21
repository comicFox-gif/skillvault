import { NextResponse } from "next/server";
import { addEvidence, listEvidence } from "@/lib/server/disputeStore";
import { type DisputeEvidenceItem } from "@/lib/disputeEvidence";
import { checkRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

type ParamsContext = {
  params: Promise<{ matchId: string }> | { matchId: string };
};

async function getMatchId(context: ParamsContext) {
  const params = await Promise.resolve(context.params);
  return String(params.matchId ?? "").trim();
}

export async function GET(_request: Request, context: ParamsContext) {
  try {
    const matchId = await getMatchId(context);
    if (!matchId) return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
    const items = await listEvidence(matchId);
    return NextResponse.json({ items });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load evidence" }, { status: 500 });
  }
}

export async function POST(request: Request, context: ParamsContext) {
  try {
    const matchId = await getMatchId(context);
    if (!matchId) return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
    const limit = checkRateLimit({
      request,
      key: `disputes:evidence:${matchId}:post`,
      max: 6,
      windowMs: 5 * 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many evidence uploads. Retry in ${limit.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }

    const payload = (await request.json()) as Omit<
      DisputeEvidenceItem,
      "id" | "matchId" | "createdAt"
    >;
    const item = await addEvidence(matchId, payload);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to save evidence" }, { status: 400 });
  }
}
