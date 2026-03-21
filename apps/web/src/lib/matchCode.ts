const ROOM_CODE_MOD = 1_000_000n; // 6 digits: 000000 - 999999
const ROOM_CODE_A = 917_519n; // coprime with 1_000_000 (invertible modulo)
const ROOM_CODE_B = 371_291n;

function modNormalize(value: bigint, mod: bigint) {
  return ((value % mod) + mod) % mod;
}

function modInverse(a: bigint, mod: bigint) {
  let t = 0n;
  let newT = 1n;
  let r = mod;
  let newR = modNormalize(a, mod);

  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }

  if (r !== 1n) {
    throw new Error("Invalid room code constants: no modular inverse.");
  }
  return modNormalize(t, mod);
}

const ROOM_CODE_A_INV = modInverse(ROOM_CODE_A, ROOM_CODE_MOD);

export function encodeMatchCode(matchId: bigint | number | string): string {
  const id = typeof matchId === "bigint" ? matchId : BigInt(matchId);
  if (id < 0n) {
    throw new Error("Match ID must be non-negative");
  }
  if (id >= ROOM_CODE_MOD) {
    // Fallback to direct numeric id once contract ids exceed 6-digit reversible range.
    return id.toString();
  }
  const code = modNormalize(id * ROOM_CODE_A + ROOM_CODE_B, ROOM_CODE_MOD);
  return code.toString().padStart(6, "0");
}

export function decodeMatchCode(value: string): bigint | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  // Keep direct numeric ID support for admin/manual loads.
  if (normalized.length !== 6) {
    return BigInt(normalized);
  }

  const code = BigInt(normalized);
  const id = modNormalize((code - ROOM_CODE_B) * ROOM_CODE_A_INV, ROOM_CODE_MOD);
  return id;
}
