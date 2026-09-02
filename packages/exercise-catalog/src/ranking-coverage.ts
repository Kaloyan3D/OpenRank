/**
 * Ranking integration coverage (mapping infrastructure).
 *
 * Classifies catalog exercises against the frozen ranking engine and reports,
 * per rank-eligible exercise, how the engine routes it:
 * - "template": matched the engine catalog via a Hevy alias (templateId)
 * - "keyword":  classified through the engine's title keyword fallback
 * - "unmatched": engine reports the title as unmatched (needs curated
 *   mapping (Phase 9) or a custom exercise)
 * - "ignored":  engine deliberately skips this activity class (cardio,
 *   mobility, conditioning keywords)
 *
 * The classification logic lives here so the vitest coverage test and the
 * exceptions generator share one implementation.
 */
import { buildCatalog, computeRanks } from "@openrank/ranking-core";
import type { CatalogTemplate } from "@openrank/ranking-core";
import type { CatalogV1, TrackingType } from "./schema";
import { bodyweightVariantOf } from "./normalize";

export type CoverageStatus = "template" | "keyword" | "unmatched" | "ignored";

export interface CoverageEntry {
  exerciseId: string;
  status: CoverageStatus;
  /** Engine group when status is template|keyword. */
  group: string | null;
  /** Engine unmatched reason when status is unmatched. */
  reason?: string;
}

/** Representative set per tracking type (reps <= 12, positive effective load). */
export const COVERAGE_SETS: Record<TrackingType, { weight: number; reps: number }[]> = {
  weight_reps: [{ weight: 100, reps: 5 }],
  bodyweight_reps: [{ weight: 0, reps: 10 }],
  bodyweight_weighted: [{ weight: 20, reps: 6 }],
  bodyweight_assisted: [{ weight: 30, reps: 8 }],
  reps_only: [{ weight: 0, reps: 12 }],
  duration: [{ weight: 0, reps: 30 }],
  distance_duration: [{ weight: 0, reps: 30 }],
};

export interface ClassifyOptions {
  bodyweightKg?: number;
  sex?: string;
}

/** Resolve the Hevy template id attached to an exercise by the alias build. */
export function templateIdFor(
  catalog: CatalogV1,
  exerciseId: string,
): string | null {
  const alias = catalog.aliases.find(
    (a) => a.exerciseId === exerciseId && a.source === "hevy-templates" && a.sourceId != null,
  );
  return alias?.sourceId ?? null;
}

/** Engine-effective tracking type (title markers override the catalog default). */
function effectiveTrackingType(ex: CatalogV1["exercises"][number]): TrackingType {
  const variant = bodyweightVariantOf(ex.name);
  if (variant === "assisted") return "bodyweight_assisted";
  if (variant === "weighted") return "bodyweight_weighted";
  return ex.trackingType;
}

/**
 * Classify every rank-eligible catalog exercise against the ranking engine.
 * One engine run per exercise keeps results isolated (the engine keys lifts
 * by title and renames catalog-matched lifts to the template title).
 */
export function classifyCatalog(
  catalog: CatalogV1,
  templates: readonly CatalogTemplate[],
  options: ClassifyOptions = {},
): CoverageEntry[] {
  const engineCatalog = buildCatalog(templates);
  const templateById = new Map(templates.filter((t) => t.id != null).map((t) => [t.id as string, t]));
  const eligible = catalog.exercises.filter((e) => e.ranking.eligible && e.ranking.group !== null);
  const entries: CoverageEntry[] = [];

  for (const ex of eligible) {
    const templateId = templateIdFor(catalog, ex.id);
    const sessions = ["2026-01-01", "2026-01-02", "2026-01-03"].map((date) => ({
      date,
      title: "Coverage",
      exercises: [
        {
          title: ex.name,
          templateId,
          type: ex.trackingType,
          // The engine overrides the type from assisted/weighted title
          // markers; pick a representative set for that effective type so
          // the synthetic load stays positive.
          sets: COVERAGE_SETS[effectiveTrackingType(ex)],
        },
      ],
    }));
    const result = computeRanks(sessions, engineCatalog, {
      bodyweightKg: options.bodyweightKg ?? 80,
      sex: options.sex ?? "m",
    });

    if (result.unmatched.has(ex.name)) {
      entries.push({
        exerciseId: ex.id,
        status: "unmatched",
        group: null,
        reason: result.unmatchedDetails.get(ex.name)?.reason,
      });
      continue;
    }

    // The engine renames catalog-matched lifts to the template title.
    const candidates = new Set<string>([ex.name]);
    if (templateId != null) {
      const tpl = templateById.get(templateId);
      if (tpl?.title) candidates.add(tpl.title);
    } else {
      const byTitle = engineCatalog.byTitle.get(engineCatalog.norm(ex.name));
      if (byTitle?.title) {
        candidates.add(byTitle.title);
      } else {
        const canon = engineCatalog.canon(ex.name);
        const byCanonical = canon ? engineCatalog.byCanonical.get(canon) : undefined;
        if (byCanonical?.title) candidates.add(byCanonical.title);
      }
    }

    let found: string | null = null;
    for (const [groupKey, group] of Object.entries(result.groups)) {
      if (
        group.lifts.some((l) => candidates.has(l.title)) ||
        group.used.some((l) => candidates.has(l.title)) ||
        group.excluded.some((l) => candidates.has(l.title))
      ) {
        found = groupKey;
        break;
      }
    }

    if (found === null) {
      // Not unmatched, not routed anywhere: the engine's keyword table
      // deliberately skips this activity class (cardio/mobility/conditioning).
      entries.push({ exerciseId: ex.id, status: "ignored", group: null });
    } else {
      entries.push({
        exerciseId: ex.id,
        status: templateId != null ? "template" : "keyword",
        group: found,
      });
    }
  }

  return entries;
}