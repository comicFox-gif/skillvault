export type DisputeMessageItem = {
  id: string;
  matchId: string;
  senderRole: "admin" | "system";
  senderAddress: string;
  message: string;
  createdAt: number;
};

export type DisputeStarterRole = "creator" | "opponent" | "unknown";

export function getDisputeAutoMessageText(starterRole: DisputeStarterRole = "unknown") {
  const starterLabel =
    starterRole === "creator"
      ? "the creator"
      : starterRole === "opponent"
        ? "the opponent"
        : "a player";
  return `A dispute has been started by ${starterLabel}. Admin will join the chat shortly. Both players have 10 minutes to upload real match evidence to speed up review. If only one side uploads evidence within 30 minutes, that side gets priority for escrow release.`;
}

export const DISPUTE_AUTO_MESSAGE_TEXT = getDisputeAutoMessageText("unknown");

export async function loadDisputeMessages(matchId: string): Promise<DisputeMessageItem[]> {
  try {
    const response = await fetch(`/api/disputes/${encodeURIComponent(matchId)}/messages`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { items?: DisputeMessageItem[] };
    return Array.isArray(payload.items) ? payload.items : [];
  } catch {
    return [];
  }
}

export async function appendDisputeMessage(
  matchId: string,
  payload: Omit<DisputeMessageItem, "id" | "matchId" | "createdAt">,
) {
  const response = await fetch(`/api/disputes/${encodeURIComponent(matchId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const payloadJson = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payloadJson.error || "Failed to send message.");
  }
}

export async function ensureDisputeAutoMessage(matchId: string, starterRole: DisputeStarterRole = "unknown") {
  try {
    const url = new URL(`/api/disputes/${encodeURIComponent(matchId)}/messages`, window.location.origin);
    url.searchParams.set("ensureAuto", "1");
    url.searchParams.set("starter", starterRole);
    await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
    });
  } catch {
    // ignore auto-message fetch errors
  }
}

export function getDisputeAutoMessage(starterRole: DisputeStarterRole = "unknown") {
  return {
    senderRole: "system" as const,
    senderAddress: "system",
    message: getDisputeAutoMessageText(starterRole),
  };
}
