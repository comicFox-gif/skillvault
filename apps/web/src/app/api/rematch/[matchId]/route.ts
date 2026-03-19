import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RematchStatus = "pending" | "joined" | "cancelled";

type RematchIntent = {
  oldMatchId: string;
  newMatchId: string;
  newRoomCode: string;
  requestedBy: string;
  requestedByRole: "creator" | "opponent";
  creator: string;
  opponent: string;
  stake: string;
  timeframe: string;
  joinMins: string;
  game: string;
  platform: string;
  status: RematchStatus;
  createdAt: number;
  updatedAt: number;
  joinedBy?: string;
  cancelledBy?: string;
};

type Store = {
  byOldMatchId: Record<string, RematchIntent>;
};

const STORE_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "rematch-intents.json");

async function ensureStore() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const empty: Store = { byOldMatchId: {} };
    await fs.writeFile(STORE_PATH, JSON.stringify(empty, null, 2), "utf8");
  }
}

async function readStore(): Promise<Store> {
  await ensureStore();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { byOldMatchId: parsed.byOldMatchId ?? {} };
  } catch {
    return { byOldMatchId: {} };
  }
}

async function writeStore(store: Store) {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

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

    const store = await readStore();
    const item = store.byOldMatchId[matchId] ?? null;
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

    const store = await readStore();
    const now = Date.now();

    if (action === "create") {
      const intent = body.intent;
      if (!intent) return NextResponse.json({ error: "Missing intent payload" }, { status: 400 });

      const item: RematchIntent = {
        oldMatchId: matchId,
        newMatchId: String(intent.newMatchId ?? "").trim(),
        newRoomCode: String(intent.newRoomCode ?? "").trim(),
        requestedBy: String(intent.requestedBy ?? "").trim().toLowerCase(),
        requestedByRole: intent.requestedByRole === "opponent" ? "opponent" : "creator",
        creator: String(intent.creator ?? "").trim().toLowerCase(),
        opponent: String(intent.opponent ?? "").trim().toLowerCase(),
        stake: String(intent.stake ?? "").trim(),
        timeframe: String(intent.timeframe ?? "").trim(),
        joinMins: String(intent.joinMins ?? "").trim(),
        game: String(intent.game ?? "").trim(),
        platform: String(intent.platform ?? "").trim(),
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };

      if (!item.newMatchId || !item.newRoomCode || !item.requestedBy || !item.creator || !item.opponent) {
        return NextResponse.json({ error: "Invalid rematch create payload" }, { status: 400 });
      }

      store.byOldMatchId[matchId] = item;
      await writeStore(store);
      return NextResponse.json({ item }, { status: 201 });
    }

    const existing = store.byOldMatchId[matchId];
    if (!existing) {
      return NextResponse.json({ error: "Rematch intent not found" }, { status: 404 });
    }

    if (action === "join") {
      const actor = String(body.actor ?? "").trim().toLowerCase();
      existing.status = "joined";
      existing.joinedBy = actor || existing.joinedBy;
      existing.updatedAt = now;
    }

    if (action === "cancel") {
      const actor = String(body.actor ?? "").trim().toLowerCase();
      existing.status = "cancelled";
      existing.cancelledBy = actor || existing.cancelledBy;
      existing.updatedAt = now;
    }

    store.byOldMatchId[matchId] = existing;
    await writeStore(store);
    return NextResponse.json({ item: existing });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update rematch intent" }, { status: 500 });
  }
}
