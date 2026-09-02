import { describe, expect, it } from "vitest";
import { uuidv7, uuidv7From } from "./uuid";

const webCrypto = (
  globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }
).crypto;
if (!webCrypto?.getRandomValues) throw new Error("Web Crypto unavailable in test env");
const rand: (n: number) => Uint8Array = (n) => webCrypto.getRandomValues!(new Uint8Array(n));

describe("uuidv7 (RFC 9562)", () => {
  it("embeds the timestamp, version 7 and the 10xx variant", () => {
    const t = 1777777777777;
    const id = uuidv7From(t, rand);
    // 8-4-4-4-12 hex layout.
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // The first 48 bits encode the timestamp (ms, big-endian).
    const hi = parseInt(id.slice(0, 8), 16);
    const lo = parseInt(id.slice(9, 13), 16);
    expect(hi * 2 ** 16 + lo).toBe(t);
  });

  it("is unique across many draws", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7(1_700_000_000_000, rand)));
    expect(ids.size).toBe(5000);
  });

  it("sorts by creation time (later timestamps order after earlier ones)", () => {
    const early = uuidv7From(1_000_000_000_000, rand);
    const late = uuidv7From(1_000_000_000_001, rand);
    expect(early < late).toBe(true);
  });

  it("rejects invalid timestamps", () => {
    expect(() => uuidv7From(-1, rand)).toThrow(/non-negative/);
    expect(() => uuidv7From(Number.NaN, rand)).toThrow(/finite/);
    expect(() => uuidv7From(281474976710655 + 1, rand)).toThrow(/48-bit/);
  });

  it("works with the default randomness source (platform crypto)", () => {
    const id = uuidv7(Date.now());
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});