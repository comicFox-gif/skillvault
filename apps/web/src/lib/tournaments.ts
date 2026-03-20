export type TournamentFormat = "bracket" | "league";
export type TournamentStatus = "open" | "full" | "in_progress" | "completed";
export type TournamentMatchResult = "pending" | "home_win" | "away_win" | "draw" | "bye_home";

export type TournamentEntry = {
  id: string;
  tournamentId: string;
  wallet: string;
  username: string;
  joinedAt: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  stakeLocked: boolean;
  stakeChainId: number | null;
  stakeEscrowMatchId: string | null;
  stakeEscrowRoomCode: string | null;
  stakeLockedAt: number | null;
};

export type TournamentMatch = {
  id: string;
  tournamentId: string;
  roundNo: number;
  homeWallet: string;
  awayWallet: string | null;
  homeUsername: string;
  awayUsername: string | null;
  homeScore: number | null;
  awayScore: number | null;
  result: TournamentMatchResult;
  winnerWallet: string | null;
  escrowChainId: number | null;
  escrowMatchId: string | null;
  escrowRoomCode: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TournamentSummary = {
  id: string;
  title: string;
  game: string;
  platform: string;
  size: number;
  timeframeMins: number;
  format: TournamentFormat;
  pointsTarget: number | null;
  stakeWei: string;
  stakeChainId: number;
  status: TournamentStatus;
  createdByWallet: string;
  createdByUsername: string;
  createdAt: number;
  updatedAt: number;
  participantCount: number;
};

export type TournamentDetail = TournamentSummary & {
  entries: TournamentEntry[];
  matches: TournamentMatch[];
};

type ApiListResponse = { items?: TournamentSummary[]; error?: string };
type ApiDetailResponse = { item?: TournamentDetail; error?: string };

export async function loadTournaments(limit = 30): Promise<TournamentSummary[]> {
  const response = await fetch(`/api/tournaments?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as ApiListResponse;
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load tournaments.");
  }
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function loadTournament(id: string): Promise<TournamentDetail> {
  const response = await fetch(`/api/tournaments/${encodeURIComponent(id)}`, {
    method: "GET",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as ApiDetailResponse;
  if (!response.ok || !payload.item) {
    throw new Error(payload.error || "Tournament not found.");
  }
  return payload.item;
}

export async function createTournamentRequest(payload: {
  title: string;
  game: string;
  platform: string;
  size: number;
  timeframeMins: number;
  format: TournamentFormat;
  pointsTarget?: number | null;
  stakeWei: string;
  stakeChainId: number;
  creatorStakeEscrowMatchId: string;
  creatorWallet: string;
  creatorUsername: string;
}): Promise<TournamentDetail> {
  const response = await fetch("/api/tournaments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as ApiDetailResponse;
  if (!response.ok || !body.item) {
    throw new Error(body.error || "Failed to create tournament.");
  }
  return body.item;
}

export async function joinTournamentRequest(
  id: string,
  payload: { wallet: string; username: string; stakeEscrowMatchId: string; stakeChainId: number },
) {
  const response = await fetch(`/api/tournaments/${encodeURIComponent(id)}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as ApiDetailResponse;
  if (!response.ok || !body.item) {
    throw new Error(body.error || "Failed to join tournament.");
  }
  return body.item;
}

export async function exitTournamentRequest(id: string, payload: { wallet: string }) {
  const response = await fetch(`/api/tournaments/${encodeURIComponent(id)}/exit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as ApiDetailResponse;
  if (!response.ok || !body.item) {
    throw new Error(body.error || "Failed to exit tournament.");
  }
  return body.item;
}

export async function deleteTournamentRequest(id: string, payload: { wallet: string }) {
  const response = await fetch(`/api/tournaments/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(body.error || "Failed to delete tournament.");
  }
}

export async function linkTournamentEscrowMatchRequest(
  tournamentId: string,
  matchId: string,
  payload: { linkerWallet?: string; chainId: number; roomCode: string },
) {
  const response = await fetch(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/matches/${encodeURIComponent(matchId)}/link`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const body = (await response.json().catch(() => ({}))) as ApiDetailResponse;
  if (!response.ok || !body.item) {
    throw new Error(body.error || "Failed to link on-chain match.");
  }
  return body.item;
}

export async function bootstrapTournamentRequest(id: string) {
  const response = await fetch(`/api/tournaments/${encodeURIComponent(id)}/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const body = (await response.json().catch(() => ({}))) as ApiDetailResponse;
  if (!response.ok || !body.item) {
    throw new Error(body.error || "Failed to bootstrap tournament.");
  }
  return body.item;
}
