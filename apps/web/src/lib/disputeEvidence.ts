export type DisputeEvidenceItem = {
  id: string;
  matchId: string;
  uploader: string;
  createdAt: number;
  note: string;
  attachmentName: string;
  attachmentSizeBytes: number;
  attachmentMimeType: string;
  imageDataUrl: string;
};

export async function loadDisputeEvidence(matchId: string): Promise<DisputeEvidenceItem[]> {
  try {
    const response = await fetch(`/api/disputes/${encodeURIComponent(matchId)}/evidence`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { items?: DisputeEvidenceItem[] };
    return Array.isArray(payload.items) ? payload.items : [];
  } catch {
    return [];
  }
}

export async function appendDisputeEvidence(
  matchId: string,
  payload: Omit<DisputeEvidenceItem, "id" | "matchId" | "createdAt">,
) {
  const response = await fetch(`/api/disputes/${encodeURIComponent(matchId)}/evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const payloadJson = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payloadJson.error || "Failed to upload evidence.");
  }
}
