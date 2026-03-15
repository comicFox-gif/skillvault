const ROOM_CODE_OFFSET = 100000n;

export function encodeMatchCode(matchId: bigint | number | string): string {
  const id = typeof matchId === "bigint" ? matchId : BigInt(matchId);
  if (id < 0n) {
    throw new Error("Match ID must be non-negative");
  }
  return (id + ROOM_CODE_OFFSET).toString().padStart(6, "0");
}

export function decodeMatchCode(value: string): bigint | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const parsed = BigInt(normalized);
  if (parsed >= ROOM_CODE_OFFSET) {
    return parsed - ROOM_CODE_OFFSET;
  }

  // Backward compatibility with legacy short IDs.
  return parsed;
}
