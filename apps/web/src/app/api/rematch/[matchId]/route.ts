import { NextResponse } from "next/server";
import {
  createRematchIntent,
  getRematchIntent,
  updateRematchIntentStatus,
  type RematchIntent,
} from "@/lib/server/rematchStore";

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
    const item = await getRematchIntent(matchId);
    return NextResponse.json({ item });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load rematch intent" }, { status: 500 });
  }
}

export async function POST(request: Request, context: ParamsContext) {
  try {
    const matchId = await getMatchId(context);
    if (!matchId) return NextResponse.json({ error: "Invalid match id" }, { status: 400 });

    const body = (await request.json()) as {
      action?: "create" | "join" | "cancel";
      intent?: Omit<RematchIntent, "oldMatchId" | "status" | "createdAt" | "updatedAt">;
      actor?: string;
    };

    const action = body.action;
    if (action !== "create" && action !== "join" && action !== "cancel") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    if (action === "create") {
      const intent = body.intent;
      if (!intent) return NextResponse.json({ error: "Missing intent payload" }, { status: 400 });
      const item = await createRematchIntent(matchId, intent);
      return NextResponse.json({ item }, { status: 201 });
    }

    const existing = await getRematchIntent(matchId);
    if (!existing) {
      return NextResponse.json({ error: "Rematch intent not found" }, { status: 404 });
    }

    const actor = String(body.actor ?? "").trim().toLowerCase();
    if (action === "join") {
      const item = await updateRematchIntentStatus(matchId, "join", actor);
      return NextResponse.json({ item });
    }

    if (action === "cancel") {
      const item = await updateRematchIntentStatus(matchId, "cancel", actor);
      return NextResponse.json({ item });
    }
    return NextResponse.json({ item: existing });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update rematch intent" }, { status: 500 });
  }
}
