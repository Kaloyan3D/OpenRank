/**
 * Normalization: slugs, aliases, equipment/category/mechanic/tracking-type
 * mapping from the Free Exercise DB value domains to the canonical OpenRank
 * schema. All mappings are explicit and deterministic.
 */
import type { ExerciseCategory, ExerciseForce, ExerciseMechanic, TrackingType } from "./schema";

/** Strip accents and lowercase (same behavior as ranking-core's deburr). */
export function deburr(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** URL-safe kebab slug from an exercise name (deterministic). */
export function slugify(name: string): string {
  return deburr(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Alias lookup key: deburred, punctuation collapsed to single spaces. */
export function normalizeAlias(alias: string): string {
  return deburr(alias)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Word-order-independent alias key (used for fuzzy catalog matching like
 * "Barbell Bench Press" <-> "Bench Press (Barbell)"). Only true filler
 * words are dropped - equipment/position words stay discriminative.
 */
const CANONICAL_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "of", "and", "with", "in", "on", "for",
  "de", "du", "la", "le", "les", "des", "au", "aux", "et", "avec",
  "der", "die", "das", "den", "dem", "und", "mit",
  "el", "los", "las", "y", "con",
  "o", "os", "as", "e", "com",
  "il", "lo", "gli", "i", "con",
]);

export function canonicalAlias(alias: string): string | null {
  const tokens = normalizeAlias(alias)
    .split(" ")
    .filter((w) => w !== "" && !CANONICAL_STOPWORDS.has(w));
  if (tokens.length === 0) return null;
  return tokens.slice().sort().join(" ");
}

/** Equipment phrases stripped (first) when computing movement-core keys. */
const EQUIPMENT_PHRASES: readonly string[] = [
  "ez curl bar", "e z curl bar", "ez barbell", "trap bar", "exercise ball",
  "medicine ball", "smith machine", "cable machine", "leverage machine",
];

/** Equipment tokens stripped when computing movement-core keys. */
const EQUIPMENT_TOKENS: ReadonlySet<string> = new Set([
  "barbell", "dumbbell", "dumbbells", "cable", "machine", "kettlebell",
  "kettlebells", "band", "bands", "smith", "bodyweight", "ez", "lever",
]);

/**
 * Movement-core alias key: canonical form with equipment words removed.
 * Used for relaxed import matching ("Bench Press (Barbell)" ~ "Bench Press").
 * Position/grip words (incline, close grip...) are deliberately kept.
 * Returns null when nothing remains (the name was equipment-only).
 */
export function coreAlias(alias: string): string | null {
  const canonical = canonicalAlias(alias);
  if (!canonical) return null;
  let tokens = canonical.split(" ");
  for (const phrase of EQUIPMENT_PHRASES) {
    const joined = tokens.join(" ");
    tokens = joined.split(phrase).join(" ").split(" ").filter((w) => w !== "");
  }
  tokens = tokens.filter((w) => !EQUIPMENT_TOKENS.has(w));
  if (tokens.length === 0) return null;
  return tokens.slice().sort().join(" ");
}

// ---------------------------------------------------------------------------
// Equipment normalization
// ---------------------------------------------------------------------------

/** Free Exercise DB equipment value -> canonical equipment tag. */
export function normalizeEquipment(raw: string | null): string | null {
  switch (raw) {
    case null:
      return null;
    case "body only":
      return "bodyweight";
    case "e-z curl bar":
      return "ez-curl-bar";
    case "exercise ball":
      return "exercise-ball";
    case "foam roll":
      return "foam-roll";
    case "medicine ball":
      return "medicine-ball";
    case "kettlebells":
      return "kettlebell";
    case "none":
      return null;
    case "barbell":
    case "bands":
    case "cable":
    case "dumbbell":
    case "machine":
    case "other":
      return raw;
    default:
      // Unknown values are rejected by validation before this point in the
      // pipeline; keep the fallback total for direct calls.
      return deburr(raw).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || null;
  }
}

/** Free Exercise DB category -> canonical category. */
export function normalizeCategory(raw: string): ExerciseCategory {
  switch (raw) {
    case "strength":
    case "powerlifting":
    case "olympic weightlifting":
    case "strongman":
    case "plyometrics":
      return "strength";
    case "stretching":
      return "mobility";
    case "cardio":
      return "cardio";
    default:
      return "other";
  }
}

/** Free Exercise DB mechanic ("isolated") -> canonical mechanic. */
export function normalizeMechanic(raw: string | null): ExerciseMechanic {
  if (raw === "compound") return "compound";
  if (raw === "isolation") return "isolation";
  if (raw === "isolated") return "isolation";
  return null;
}

export function normalizeForce(raw: string | null): ExerciseForce {
  if (raw === "push" || raw === "pull" || raw === "static") return raw;
  return null;
}

// ---------------------------------------------------------------------------
// Tracking-type inference (catalog defaults; user-adjustable later)
// ---------------------------------------------------------------------------

const ASSISTED_NAME = /(?:^|\s)(assisted|band(ed)?|with band|bands)(?:$|\s)/;
const WEIGHTED_NAME = /(?:^|\s)(weighted|weight-?ed|with weight|added weight)(?:$|\s)/;

/**
 * Bodyweight-variant marker in a name ("Assisted Pull Up" -> "assisted").
 * Mirrors the ranking engine's title-based override, which wins over the
 * template/tracking type on purpose.
 */
export function bodyweightVariantOf(name: string): "assisted" | "weighted" | null {
  const deburred = deburr(name);
  if (ASSISTED_NAME.test(deburred)) return "assisted";
  if (WEIGHTED_NAME.test(deburred)) return "weighted";
  return null;
}

/**
 * Infer the catalog-default tracking type for an exercise.
 *
 * Rules (deterministic, documented in docs/RANKING_SPEC.md):
 * - stretching          -> duration
 * - cardio              -> duration
 * - strength, bodyweight equipment -> bodyweight family
 *   (name markers assisted/weighted win, mirroring the ranking engine's
 *   title-based override)
 * - strength, other equipment      -> weight_reps
 */
export function inferTrackingType(
  category: ExerciseCategory,
  equipment: string | null,
  name: string,
): TrackingType {
  if (category === "mobility" || category === "cardio") return "duration";
  const loadBearing = equipment !== null && equipment !== "bodyweight";
  if (loadBearing) return "weight_reps";
  const n = deburr(name);
  if (ASSISTED_NAME.test(n)) return "bodyweight_assisted";
  if (WEIGHTED_NAME.test(n)) return "bodyweight_weighted";
  return "bodyweight_reps";
}

/**
 * Categories whose exercises are considered rank-eligible by the ranking
 * engine (strength work measurable against bodyweight). Plyometrics is
 * explosive power (not load-progressive), strongman is event-based.
 */
export const RANK_ELIGIBLE_CATEGORIES: ReadonlySet<ExerciseCategory> = new Set([
  "strength",
]);

/** Equipment tokens that may be stripped when generating search aliases. */
const LEADING_EQUIPMENT_TOKENS: readonly string[] = [
  "barbell", "dumbbell", "dumbbells", "cable", "machine", "kettlebell",
  "kettlebells", "band", "bands", "ez curl bar", "e-z curl bar",
  "exercise ball", "medicine ball", "smith", "leverage", "bodyweight",
];

/**
 * Generate deterministic name variants for the alias index (search/import).
 * - name without a parenthetical qualifier: "Bench Press (Barbell)" -> "Bench Press"
 * - name without one leading equipment token: "Barbell Bench Press" -> "Bench Press"
 */
export function nameVariants(name: string): string[] {
  const variants: string[] = [];
  const paren = name.match(/^(.*?)\s*\([^)]*\)\s*$/);
  if (paren && (paren[1] ?? "").trim().length > 0) {
    variants.push((paren[1] ?? "").trim());
  }
  const normalized = normalizeAlias(name);
  for (const token of LEADING_EQUIPMENT_TOKENS) {
    if (normalized === token) continue;
    if (normalized.startsWith(token + " ")) {
      const rest = normalized.slice(token.length + 1).trim();
      if (rest.length >= 3) variants.push(rest);
      break;
    }
  }
  return [...new Set(variants)].filter((v) => normalizeAlias(v) !== normalizeAlias(name));
}