/**
 * RFC 9562 UUIDv7 (time-ordered) for locally owned mutable entities.
 *
 * UUIDv7 embeds a 48-bit Unix millisecond timestamp + 74 random bits, so ids
 * sort roughly by creation time (good index locality) and are globally unique
 * - suitable for future offline-first sync. Dataset-derived rows (catalog
 * exercises, muscles, aliases) keep their stable canonical ids instead.
 *
 * The randomness source is injected: node:crypto in tests/tools,
 * crypto.getRandomValues in the app runtime.
 */

export type RandomBytes = (byteCount: number) => Uint8Array;

/** Pure UUIDv7 builder (exposed for tests). */
export function uuidv7From(timestampMs: number, random: RandomBytes): string {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new Error("uuidv7 requires a finite non-negative timestamp");
  }
  if (timestampMs > 281474976710655) {
    throw new Error("uuidv7 timestamp out of 48-bit range");
  }
  const bytes = random(16);
  if (bytes.length !== 16) throw new Error("random source must return 16 bytes");
  // 48-bit big-endian timestamp.
  const tsHigh = Math.floor(timestampMs / 2 ** 32);
  const tsLow = timestampMs >>> 0;
  bytes[0] = (tsHigh >> 8) & 0xff;
  bytes[1] = tsHigh & 0xff;
  bytes[2] = (tsLow >>> 24) & 0xff;
  bytes[3] = (tsLow >>> 16) & 0xff;
  bytes[4] = (tsLow >>> 8) & 0xff;
  bytes[5] = tsLow & 0xff;
  // version 7 + variant 10xx.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  let out = "";
  for (let i = 0; i < 16; i++) {
    const b = bytes[i] ?? 0;
    out += (b < 16 ? "0" : "") + b.toString(16);
    if (i === 3 || i === 5 || i === 7 || i === 9) out += "-";
  }
  return out;
}

/** Best-effort default randomness (Web Crypto, available in Node >= 19 and RN). */
const defaultRandom: RandomBytes = (n) => {
  const g = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
  if (g && typeof g.getRandomValues === "function") {
    return g.getRandomValues(new Uint8Array(n));
  }
  throw new Error("no crypto.getRandomValues available; inject a RandomBytes source");
};

export function uuidv7(nowMs: number, random: RandomBytes = defaultRandom): string {
  return uuidv7From(nowMs, random);
}