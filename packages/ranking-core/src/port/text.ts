/**
 * Text utilities - faithful port of the legacy engine's string handling.
 * Regexes are copied character-for-character from the upstream source.
 */
import { GROUP_HINTS } from "./constants.js";

/** Strip accents/diacritics for robust comparison. */
export function deburr(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary hint matching (ported verbatim).
 *
 * Inflection tails covered (compact alternation): -s/-es, -e/-aux, -en/-er,
 * -o/-a/-i. For the LAST word of a single-word needle we additionally allow
 * any trailing letters when the word is long enough (>= 5 chars) so short
 * prefixes like `up` / `in` don't over-match. The leading boundary is always
 * strict (start-of-string OR a non-alphanumeric char).
 */
export function matchesWord(haystack: string, needle: string): boolean {
  const words = needle.trim().split(/\s+/).map(escapeRegex);
  if (words.length === 0) return false;
  const suffix = "(?:es|s|e|aux|en|er|o|a|i)?";
  const compound =
    words.length === 1 && (words[0] ?? "").length >= 5 ? "[a-z]*" : suffix;
  const inner = words
    .map((w, i) => `${w}${i === words.length - 1 ? compound : suffix}`)
    .join("\\s+");
  const re = new RegExp(`(?:^|[^a-z0-9])${inner}(?:$|[^a-z0-9])`);
  return re.test(haystack);
}

/**
 * Guess a group key from a free-form exercise title. Returns the group key,
 * "__skip__" for cardio/mobility (caller should silently ignore), or null
 * when no hint matches. Used as a fallback for CSV-mode exercises whose
 * template isn't in the English-only catalog.
 */
export function inferGroupFromTitle(
  rawTitle: string | null | undefined,
): GroupKeyOrSkip | null {
  const norm = deburr(rawTitle ?? "");
  if (!norm) return null;
  for (const [group, hints] of GROUP_HINTS) {
    for (const h of hints) {
      if (matchesWord(norm, h)) return group;
    }
  }
  return null;
}

export type GroupKeyOrSkip = (typeof GROUP_HINTS)[number][0];

/**
 * Detect assisted/weighted bodyweight variants directly from the exercise
 * title. Wins over the template type when it fires (the markers
 * unambiguously carry the load semantics).
 */
export function detectBodyweightVariantFromTitle(
  title: string | null | undefined,
): "bodyweight_assisted" | "bodyweight_weighted" | null {
  if (!title) return null;
  const t = deburr(String(title)).toLowerCase();
  const assisted =
    /(?:^|[^a-z0-9])(assisted|assiste|assistee|aided|assist|band|banded|con banda|con goma|elastico|elastique|mit band|assistita|assistito|assistida|assistido)(?:$|[^a-z0-9])/;
  const weighted =
    /(?:^|[^a-z0-9])(weighted|leste|lestee|charge|chargee|con peso|com peso|gewichtet|zusatzgewicht|zavorrato|zavorrata|pesado|pesada|belt)(?:$|[^a-z0-9])/;
  if (assisted.test(t)) return "bodyweight_assisted";
  if (weighted.test(t)) return "bodyweight_weighted";
  return null;
}
