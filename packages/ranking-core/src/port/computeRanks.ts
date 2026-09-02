/**
 * Rank computation - faithful port of the legacy engine's core.
 * Every branch mirrors packages/ranking-core/src/legacy/engine.js.
 */
import {
  COMPOSITE_WEIGHTS,
  FEW_SESSIONS_TIER_CAP,
  GROUPS,
  GROUP_COEFFS,
  ISOLATION_TIER_CAP,
  MIN_SESSIONS,
  PRIMARY_TO_GROUP,
  RANK_TIERS,
  STRENGTH_TYPES,
} from "./constants.js";
import {
  bodyweightFraction,
  compositeRatio,
  equipFactor,
  estimate1RM,
  ratioToTierIndex,
  sexFactor,
} from "./math.js";
import { effectiveLoad } from "./load.js";
import {
  deburr,
  detectBodyweightVariantFromTitle,
  inferGroupFromTitle,
} from "./text.js";
import { nextTierRecommendation } from "./recommendation.js";
import type {
  CatalogTemplate,
  GroupConfig,
  GroupKey,
  GroupResult,
  Lift,
  RankCatalog,
  RankComputeOptions,
  RankResult,
  RankSession,
  UnmatchedDetail,
} from "./types.js";

/** Convert workouts from the Hevy API into the engine's "sessions" format. */
export function workoutsToSessions(workouts: unknown): RankSession[] {
  const list = Array.isArray(workouts) ? workouts : [];
  return list.map((w) => {
    const workout = (w ?? {}) as Record<string, unknown>;
    const exercises = Array.isArray(workout.exercises)
      ? workout.exercises
      : [];
    return {
      date: String(
        (workout.start_time as string | undefined) ??
          (workout.created_at as string | undefined) ??
          "",
      ).slice(0, 10),
      title: (workout.title as string | undefined) ?? "",
      exercises: exercises.map((ex) => {
        const e = (ex ?? {}) as Record<string, unknown>;
        const sets = Array.isArray(e.sets) ? e.sets : [];
        return {
          title: (e.title as string | undefined) ?? "",
          templateId:
            (e.exercise_template_id as string | null | undefined) ?? null,
          sets: sets.map((s) => {
            const set = (s ?? {}) as Record<string, unknown>;
            return {
              weight: (set.weight_kg as number | null | undefined) ?? null,
              reps: (set.reps as number | null | undefined) ?? null,
              type: (set.type as string | undefined) ?? "normal",
            };
          }),
        };
      }),
    };
  });
}

/** Coefficient match result for an exercise inside a group. */
interface CoeffMatch {
  coeff: number;
  isolation: boolean;
}

/**
 * Returns { coeff, isolation } for a given exercise in the group.
 * If no keyword matches, uses the default coefficient adjusted by equipment
 * and isolation = false (we assume the default targets a compound lift).
 */
function matchCoeff(
  title: string,
  groupKey: GroupKey,
  equipment: string | null | undefined,
): CoeffMatch {
  const t = deburr(title);
  for (const entry of GROUP_COEFFS[groupKey] ?? []) {
    if (entry.k.some((kw) => t.includes(kw))) {
      return { coeff: entry.c, isolation: entry.isolation === true };
    }
  }
  const cfg: GroupConfig = GROUPS[groupKey];
  return { coeff: cfg.def * equipFactor(equipment), isolation: false };
}

/** Internal mutable lift accumulator (pre-sessionsCount/eqRatio). */
interface AggLift {
  title: string;
  best1RM: number;
  load: number;
  reps: number;
  date: string | null;
  coeff: number;
  isolation: boolean;
  sessions: Set<string>;
}

/**
 * Computes the rank of each muscle group.
 *
 * @param sessions - [{ date, exercises:[{ title, templateId?, sets:[{weight,reps,type?}] }] }]
 * @param catalog  - result of buildCatalog()
 * @param opts     - { bodyweightKg, sex, minSessions }
 */
export function computeRankGroups(
  sessions: readonly RankSession[],
  catalog: RankCatalog,
  { bodyweightKg, sex = "male", minSessions = MIN_SESSIONS }: RankComputeOptions = {},
): RankResult {
  const bw = Number(bodyweightKg);
  const hasBw = Number.isFinite(bw) && bw > 0;
  const factor = sexFactor(sex);

  // groupKey -> Map(title -> aggregated lift). A "lift" = best set on that exercise.
  const perGroup: Record<string, Map<string, AggLift>> = {};
  for (const key of Object.keys(GROUPS)) perGroup[key] = new Map();
  const unmatchedTitles = new Set<string>();
  // title -> { sessions:Set<date>, reason:'unknown'|'no_load' }
  const unmatchedDetails = new Map<string, UnmatchedDetail>();

  // Track how each strength exercise was routed (distinct titles), so the
  // UI can warn the user when many exercises came in via the keyword
  // fallback instead of the exact English catalog.
  const catalogMatched = new Set<string>();
  const inferredMatched = new Set<string>();

  for (const s of sessions) {
    for (const ex of s.exercises ?? []) {
      let tpl: CatalogTemplate | null = ex.templateId
        ? (catalog.byId.get(ex.templateId) ?? null)
        : null;
      if (!tpl && ex.title) tpl = catalog.byTitle.get(catalog.norm(ex.title)) ?? null;
      // Fuzzy fallback: same words in any order (`Barbell Bench Press` <>
      // catalog's `Bench Press (Barbell)`), or the same title with extra
      // equipment/position stopwords the user may have added.
      if (!tpl && ex.title && catalog.byCanonical && catalog.canon) {
        const canon = catalog.canon(ex.title);
        if (canon) tpl = catalog.byCanonical.get(canon) ?? null;
      }
      const primary = tpl?.primary;
      let groupKey = primary != null ? (PRIMARY_TO_GROUP[primary] ?? null) : null;
      const cameFromCatalog = groupKey != null;
      const rawTitle = ex.title ?? tpl?.title ?? "";

      let type = ex.type ?? tpl?.type ?? "weight_reps";
      // Title-based override for assisted / weighted bodyweight variants.
      // Wins over the template type on purpose: these markers unambiguously
      // carry the load semantics.
      const variantOverride = detectBodyweightVariantFromTitle(rawTitle);
      if (variantOverride) type = variantOverride;
      // Cardio, mobility, etc.: silently ignored.
      let isStrength = STRENGTH_TYPES.has(type);

      // Fallback for CSV imports in non-English locales: try to infer the
      // group directly from the title using multilingual keyword hints.
      if (!groupKey && rawTitle) {
        const guess = inferGroupFromTitle(rawTitle);
        if (guess === "__skip__") {
          isStrength = false; // silently ignored (cardio / mobility / combat)
        } else if (guess) {
          groupKey = guess;
        }
      }

      if (!groupKey) {
        if (rawTitle && isStrength) {
          unmatchedTitles.add(rawTitle);
          const d = unmatchedDetails.get(rawTitle) ?? {
            title: rawTitle,
            sessions: new Set<string>(),
            reason: "unknown" as const,
          };
          if (s.date) d.sessions.add(s.date);
          unmatchedDetails.set(rawTitle, d);
        }
        continue;
      }
      const title = tpl?.title ?? ex.title ?? "";
      const equipment = tpl?.equipment;

      let hadUsableSet = false;
      let bestOfExercise: {
        title: string;
        best1RM: number;
        load: number;
        reps: number;
        date: string | null;
      } | null = null;

      for (const set of ex.sets ?? []) {
        if (set.type === "warmup") continue;
        const reps = Number(set.reps);
        if (!Number.isFinite(reps) || reps <= 0) continue;

        let load = effectiveLoad(set.weight, type, bw);
        if (
          load == null &&
          bw > 0 &&
          (type === "reps_only" || type === "bodyweight_reps")
        ) {
          load = bw * bodyweightFraction(title, groupKey);
        }
        if (load == null || load <= 0) continue;

        const oneRm = estimate1RM(load, reps);
        if (oneRm <= 0) continue;

        hadUsableSet = true;
        if (!bestOfExercise || oneRm > bestOfExercise.best1RM) {
          bestOfExercise = {
            title,
            best1RM: oneRm,
            load,
            reps: Number(set.reps),
            date: s.date ?? null,
          };
        }
      }

      // No usable set: surface it ONLY if the type is a "strength" one
      // (otherwise = cardio/mobility -> silent).
      if (!hadUsableSet) {
        if (rawTitle && isStrength) {
          const d = unmatchedDetails.get(rawTitle) ?? {
            title: rawTitle,
            sessions: new Set<string>(),
            reason: "no_load" as const,
          };
          if (s.date) d.sessions.add(s.date);
          unmatchedDetails.set(rawTitle, d);
        }
        continue;
      }

      if (cameFromCatalog) catalogMatched.add(rawTitle);
      else if (rawTitle) inferredMatched.add(rawTitle);

      const map = perGroup[groupKey] as Map<string, AggLift>;
      const prev = map.get(title);
      if (!prev) {
        const meta = matchCoeff(title, groupKey, equipment);
        const best = bestOfExercise as NonNullable<typeof bestOfExercise>;
        map.set(title, {
          ...best,
          coeff: meta.coeff,
          isolation: meta.isolation,
          sessions: new Set(best.date ? [best.date] : []),
        });
      } else {
        const best = bestOfExercise as NonNullable<typeof bestOfExercise>;
        if (best.best1RM > prev.best1RM) {
          prev.best1RM = best.best1RM;
          prev.load = best.load;
          prev.reps = best.reps;
          prev.date = best.date;
        }
        if (best.date) prev.sessions.add(best.date);
      }
    }
  }

  const groups = {} as Record<GroupKey, GroupResult>;
  for (const [key, cfg] of Object.entries(GROUPS) as [GroupKey, GroupConfig][]) {
    // Enrich each lift with eqRatio + sessionsCount, sorted desc.
    const groupMap = perGroup[key] as Map<string, AggLift>;
    const allLifts: Lift[] = [...groupMap.values()]
      .map((l) => ({
        title: l.title,
        best1RM: l.best1RM,
        load: l.load,
        reps: l.reps,
        date: l.date,
        coeff: l.coeff,
        isolation: l.isolation,
        sessionsCount: l.sessions.size,
        eqRatio: hasBw ? l.best1RM / l.coeff / bw : null,
      }))
      .sort((a, b) => (b.eqRatio ?? 0) - (a.eqRatio ?? 0));

    // Categorization
    const enoughSessions = (l: Lift) => l.sessionsCount >= minSessions;
    const compounds = allLifts.filter((l) => !l.isolation && enoughSessions(l));
    const isolations = allLifts.filter((l) => l.isolation && enoughSessions(l));

    let used: Lift[] = [];
    let source: GroupResult["source"] = null;
    let cap: number | null = null;

    if (compounds.length > 0) {
      used = compounds.slice(0, COMPOSITE_WEIGHTS.length);
      source = "compound";
    } else if (isolations.length > 0) {
      // No qualifying compound: fall back to isolation lifts (cap Titan).
      used = isolations.slice(0, COMPOSITE_WEIGHTS.length);
      source = "isolation";
      cap = ISOLATION_TIER_CAP;
    } else if (allLifts.length > 0) {
      // No exercise reaches MIN_SESSIONS: use whatever we have (cap Platinum),
      // so the group isn't shown as empty when there's actually data.
      used = allLifts.slice(0, COMPOSITE_WEIGHTS.length);
      source = "few_sessions";
      cap = FEW_SESSIONS_TIER_CAP;
    }

    const eqRatio = used.length ? compositeRatio(used) : null;
    const capped = cap != null;

    // Everything that wasn't used: surface it with a reason.
    const usedTitles = new Set(used.map((l) => l.title));
    const excluded = allLifts
      .filter((l) => !usedTitles.has(l.title))
      .map((l) => ({
        ...l,
        reason: !enoughSessions(l) ? ("few_sessions" as const) : ("isolation" as const),
      }));

    let tierIndex: number | null = null;
    let progress = 0;
    let next: GroupResult["next"] = null;
    if (eqRatio != null) {
      tierIndex = ratioToTierIndex(eqRatio, cfg.thresholds, factor);
      if (cap != null && tierIndex > cap) tierIndex = cap;
      const cur = (cfg.thresholds[tierIndex] ?? 0) * factor;
      const nextThresh =
        tierIndex < cfg.thresholds.length - 1
          ? (cfg.thresholds[tierIndex + 1] ?? 0) * factor
          : null;
      if (nextThresh != null) {
        const span = nextThresh - cur;
        progress = span > 0 ? (eqRatio - cur) / span : 1;
        next = {
          tier: RANK_TIERS[tierIndex + 1] as NonNullable<
            GroupResult["next"]
          >["tier"],
          ratio: nextThresh,
          remaining: Math.max(0, nextThresh - eqRatio),
        };
      } else {
        progress = 1;
      }
    }

    const g: GroupResult = {
      group: cfg,
      lifts: allLifts,
      used,
      excluded,
      best: used[0] ?? allLifts[0] ?? null,
      eqRatio,
      source,
      capped,
      hasData: used.length > 0 && eqRatio != null,
      tierIndex,
      tier: tierIndex != null ? (RANK_TIERS[tierIndex] ?? null) : null,
      next,
      progress: Math.min(1, Math.max(0, progress)),
      recommendation: null,
    };
    g.recommendation = nextTierRecommendation(g, { bodyweightKg: bw });
    groups[key] = g;
  }

  return {
    bodyweightKg: hasBw ? bw : null,
    sex,
    minSessions,
    groups,
    unmatched: unmatchedTitles,
    unmatchedDetails,
    matchStats: {
      catalog: catalogMatched.size,
      inferred: inferredMatched.size,
      total: catalogMatched.size + inferredMatched.size,
    },
  };
}
