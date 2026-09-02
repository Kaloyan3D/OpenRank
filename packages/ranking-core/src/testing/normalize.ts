/**
 * Deterministic JSON-safe projection of a ranking result.
 *
 * Converts Sets -> sorted arrays and Maps -> key-sorted [key, value] entries
 * so both engine outputs and the JSON golden fixtures can be compared with
 * strict deep equality. Numbers are preserved exactly (no rounding): golden
 * compatibility requires bit-identical IEEE doubles end to end.
 *
 * The fixture generator (scripts/generate-ranking-fixtures.mjs) implements
 * the exact same transformation when writing fixtures - keep them in sync.
 */
import type { VersionedRankResult } from "../rank.js";

export type JsonSafe =
  | null
  | boolean
  | number
  | string
  | JsonSafe[]
  | { [k: string]: JsonSafe };

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizeValue(v: unknown): JsonSafe {
  if (v instanceof Set) {
    return [...v].map((x) => String(x)).sort(byString);
  }
  if (v instanceof Map) {
    return [...v.entries()]
      .map(([k, val]) => [String(k), normalizeValue(val)] as [string, JsonSafe])
      .sort((a, b) => byString(a[0], b[0]));
  }
  if (Array.isArray(v)) {
    return v.map(normalizeValue);
  }
  if (v !== null && typeof v === "object") {
    const out: { [k: string]: JsonSafe } = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "rankingVersion") continue; // port-only additive metadata
      out[k] = normalizeValue(val);
    }
    return out;
  }
  if (v === undefined) return null;
  if (
    typeof v === "number" ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    v === null
  ) {
    return v;
  }
  return String(v);
}

export function normalizeRankResult(result: VersionedRankResult): JsonSafe {
  return normalizeValue(result);
}
