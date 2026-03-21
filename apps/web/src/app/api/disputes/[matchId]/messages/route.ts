import { NextResponse } from "next/server";
import { addMessage, ensureAutoMessage, listMessages } from "@/lib/server/disputeStore";
import { type DisputeMessageItem, type DisputeStarterRole } from "@/lib/disputeMessages";
import { checkRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

type ParamsContext = {
  params: Promise<{ matchId: string }> | { matchId: string };
};

async function getMatchId(context: ParamsContext) {
  const params = await Promise.resolve(context.params);
  return String(params.matchId ?? "").trim();
}

export async function GET(request: Request, context: ParamsContext) {
  try {
    const matchId = await getMatchId(context);
    if (!matchId) return NextResponse.json({ error: "Invalid match id" }, { status: 400 });

    const url = new URL(request.url);
    if (url.searchParams.get("ensureAuto") === "1") {
      const starter = url.searchParams.get("starter");
      const starterRole: DisputeStarterRole =
        starter === "creator" || starter === "opponent" ? starter : "unknown";
      await ensureAutoMessage(matchId, starterRole);
    }

    const items = await listMessages(matchId);
    return NextResponse.json({ items });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load messages" }, { status: 500 });
  }
}

export async function POST(request: Request, context: ParamsContext) {
  try {
    const matchId = await getMatchId(context);
    if (!matchId) return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
    const limit = checkRateLimit({
      request,
      key: `disputes:messages:${matchId}:post`,
      max: 12,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return NextResponse.json(
        { error: `Too many message requests. Retry in ${limit.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }

    const payload = (await request.json()) as Omit<
      DisputeMessageItem,
      "id" | "matchId" | "createdAt"
    >;
    const item = await addMessage(matchId, payload);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to save message" }, { status: 400 });
  }
}
