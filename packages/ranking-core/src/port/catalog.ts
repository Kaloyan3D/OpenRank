/**
 * Catalog building - faithful port of the legacy engine.
 */
import { CANON_STOPWORDS } from "./constants.js";
import { deburr } from "./text.js";
import type { CatalogTemplate, RankCatalog } from "./types.js";

/**
 * Builds an index of the exercise catalog (by id, by normalized title, and
 * by canonical title for fuzzy word-order lookups).
 */
export function buildCatalog(templates: readonly CatalogTemplate[]): RankCatalog {
  const byId = new Map<string, CatalogTemplate>();
  const byTitle = new Map<string, CatalogTemplate>();
  // Secondary index for fuzzy lookups: same words in any order, no parens,
  // no equipment/stopwords. Lets `Barbell Bench Press` match the catalog's
  // `Bench Press (Barbell)`, `Squat Barbell` match `Squat (Barbell)`, etc.
  const byCanonical = new Map<string, CatalogTemplate>();
  const norm = (s: string) => deburr(String(s).trim());
  for (const t of templates) {
    if (t.id) byId.set(t.id, t);
    if (t.title) {
      byTitle.set(norm(t.title), t);
      const canon = canonicalTitle(t.title);
      if (canon && !byCanonical.has(canon)) byCanonical.set(canon, t);
    }
  }
  return { byId, byTitle, byCanonical, norm, canon: canonicalTitle };
}

/**
 * Canonical form of an exercise title used as a fallback lookup key when the
 * exact normalized title isn't found. Strips accents, punctuation,
 * parentheses and common stopwords, then sorts the remaining tokens
 * alphabetically so word-order variations collapse to the same key.
 * Returns null when nothing meaningful is left.
 */
export function canonicalTitle(title: string | null | undefined): string | null {
  const raw = deburr(String(title ?? ""))
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .trim();
  if (!raw) return null;
  const tokens = raw
    .split(/\s+/)
    .filter((w) => w !== "" && !CANON_STOPWORDS.has(w));
  if (tokens.length === 0) return null;
  return tokens.slice().sort().join(" ");
}
