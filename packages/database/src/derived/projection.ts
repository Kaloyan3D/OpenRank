/**
 * Rank projection (Phase 5): engine results -> per-scope rank states for the
 * snapshot/event store. Application-level interpretation only - the frozen
 * engine supplies every strength number (eqRatio, tier thresholds, composite
 * weights, recommendation); this layer adds eligibility gating, the
 * per-exercise tier mapping, divisions and provenance.
 */

import { ratioToTierIndex, sexFactor } from "@openrank/ranking-core";
import type { GroupKey, GroupResult, Lift, VersionedRankResult } from "@openrank/ranking-core";
import { GROUPS, RANK_TIERS, ISOLATION_TIER_CAP } from "@openrank/ranking-core";
import type { RankScopeType } from "@openrank/domain";
import { PROJECTION_VERSION, ENGINE_VERSION, divisionForProgress, progressWithinTier, tierName, TOP_TIER_INDEX, sameScore } from "./divisions";
import type { RankingInputBuild } from "./ranking-input";

export interface RankState {
  scopeType: RankScopeType;
  scopeKey: string;
  tierIndex: number;
  tierName: string;
  division: string | null;
  score: number;
  progress: number | null;
  details: Record<string, unknown>;
}

export interface ExerciseRankCompute {
  exerciseId: string;
  state: RankState | null;
  /** Set when no rank exists, with the honest reason (spec H/L). */
  unavailableReason:
    | "no_bodyweight"
    | "no_qualifying_set"
    | "engine_unmatched"
    | "ambiguous_title"
    | "unsupported"
    | null;
  provisional: boolean;
  /** Single-lift data for next-rank targets (present when state exists). */
  lift: { coeff: number; best1RM: number; reps: number; load: number } | null;
}

export interface MuscleRankCompute {
  groupKey: GroupKey;
  state: RankState | null;
  unavailableReason: "no_bodyweight" | "no_qualifying_data" | null;
  contributing: Array<{
    exerciseId: string | null;
    title: string;
    role: "used" | "excluded";
    reason: string | null;
    tierIndex: number;
    eqRatio: number | null;
    coeff: number;
    isolation: boolean;
    sessionsCount: number;
  }>;
  recommendation: GroupResult["recommendation"];
}

export interface ProjectionContext {
  profileId: string;
  strengthStandard: string;
  bodyweightKg: number | null;
  bodyweightEntryId: string | null;
  build: RankingInputBuild;
}

function detailsCommon(ctx: ProjectionContext, result: VersionedRankResult): Record<string, unknown> {
  return {
    rankingVersion: result.rankingVersion,
    engineVersion: ENGINE_VERSION,
    projectionVersion: PROJECTION_VERSION,
    catalogFingerprint: ctx.build.catalogFingerprint,
    strengthStandard: ctx.strengthStandard,
    bodyweightKg: ctx.bodyweightKg,
    bodyweightEntryId: ctx.bodyweightEntryId,
  };
}

function liftTierIndex(lift: Lift, groupKey: GroupKey, factor: number): number {
  const cfg = GROUPS[groupKey];
  return ratioToTierIndex(lift.eqRatio ?? 0, cfg.thresholds, factor);
}

/** Per-exercise rank states from the rankable pass (eligible + provisional). */
export function projectExerciseRanks(ctx: ProjectionContext, result: VersionedRankResult): Map<string, ExerciseRankCompute> {
  const out = new Map<string, ExerciseRankCompute>();
  const factor = sexFactor(ctx.strengthStandard);
  const hasBw = ctx.bodyweightKg != null && ctx.bodyweightKg > 0;

  for (const info of ctx.build.titleToExercise.values()) {
    if (ctx.build.ambiguousTitles.has(info.title)) {
      out.set(info.exerciseId, { exerciseId: info.exerciseId, state: null, unavailableReason: "ambiguous_title", provisional: info.eligibility === "provisional", lift: null });
      continue;
    }
    const group = result.groups[info.engineGroup as GroupKey];
    if (!group) {
      out.set(info.exerciseId, { exerciseId: info.exerciseId, state: null, unavailableReason: "engine_unmatched", provisional: info.eligibility === "provisional", lift: null });
      continue;
    }
    const lift = group.lifts.find((l) => l.title === info.title) ?? null;
    if (!lift || lift.eqRatio == null) {
      out.set(info.exerciseId, {
        exerciseId: info.exerciseId,
        state: null,
        unavailableReason: hasBw ? "no_qualifying_set" : "no_bodyweight",
        provisional: info.eligibility === "provisional",
        lift: lift ? { coeff: lift.coeff, best1RM: lift.best1RM, reps: lift.reps, load: lift.load } : null,
      });
      continue;
    }
    let tierIndex = liftTierIndex(lift, info.engineGroup as GroupKey, factor);
    // Application-level interpretation (documented, projectionVersion'd):
    // isolation lifts cannot exceed the engine's isolation cap (Titan).
    if (lift.isolation && tierIndex > ISOLATION_TIER_CAP) tierIndex = ISOLATION_TIER_CAP;
    const progress = progressWithinTier(lift.eqRatio, tierIndex, GROUPS[info.engineGroup as GroupKey].thresholds, factor);
    const details = {
      ...detailsCommon(ctx, result),
      engineGroup: info.engineGroup,
      mappingStrategy: info.strategy,
      provisional: info.eligibility === "provisional",
      coefficient: lift.coeff,
      isolation: lift.isolation,
      sessionsCount: lift.sessionsCount,
      bestSet: { e1rm: lift.best1RM, effectiveLoadKg: lift.load, reps: lift.reps },
      isolationTierCap: lift.isolation ? ISOLATION_TIER_CAP : null,
    };
    out.set(info.exerciseId, {
      exerciseId: info.exerciseId,
      provisional: info.eligibility === "provisional",
      lift: { coeff: lift.coeff, best1RM: lift.best1RM, reps: lift.reps, load: lift.load },
      unavailableReason: null,
      state: {
        scopeType: "exercise",
        scopeKey: info.exerciseId,
        tierIndex,
        tierName: tierName(tierIndex),
        division: divisionForProgress(progress, tierIndex, TOP_TIER_INDEX),
        score: lift.eqRatio,
        progress,
        details,
      },
    });
  }
  return out;
}

/** Muscle-group rank states from the eligible-only pass (frozen aggregation). */
export function projectMuscleRanks(ctx: ProjectionContext, result: VersionedRankResult): Map<GroupKey, MuscleRankCompute> {
  const out = new Map<GroupKey, MuscleRankCompute>();
  for (const [groupKey, group] of Object.entries(result.groups) as [GroupKey, GroupResult][]) {
    const hasBw = ctx.bodyweightKg != null && ctx.bodyweightKg > 0;
    if (!group.hasData || group.eqRatio == null) {
      out.set(groupKey, {
        groupKey,
        state: null,
        unavailableReason: hasBw ? "no_qualifying_data" : "no_bodyweight",
        contributing: contributingLifts(group, ctx, sexFactor(ctx.strengthStandard)),
        recommendation: null,
      });
      continue;
    }
    const details = {
      ...detailsCommon(ctx, result),
      engineGroup: groupKey,
      aggregationSource: group.source,
      capped: group.capped,
      compositeWeights: [1.0, 0.5, 0.25],
      contributing: contributingLifts(group, ctx, sexFactor(ctx.strengthStandard)),
      nextThresholdRatio: group.next?.ratio ?? null,
      recommendation: group.recommendation
        ? {
            nextTier: group.recommendation.nextTier.name,
            topLiftTitle: group.recommendation.topLift.title,
            required1RM: group.recommendation.required1RM,
            delta1RM: group.recommendation.delta1RM,
            targetForReps: group.recommendation.targetForReps,
            currentForReps: group.recommendation.currentForReps,
            tooFar: group.recommendation.tooFar,
          }
        : null,
    };
    out.set(groupKey, {
      groupKey,
      recommendation: group.recommendation,
      unavailableReason: null,
      contributing: contributingLifts(group, ctx, sexFactor(ctx.strengthStandard)),
      state: {
        scopeType: "muscle",
        scopeKey: groupKey,
        tierIndex: group.tierIndex as number,
        tierName: group.tier ? group.tier.name : tierName(group.tierIndex as number),
        division: divisionForProgress(group.progress, group.tierIndex as number, TOP_TIER_INDEX),
        score: group.eqRatio,
        progress: group.progress,
        details,
      },
    });
  }
  return out;
}

function liftAttribution(ctx: ProjectionContext, title: string): string | null {
  if (ctx.build.ambiguousTitles.has(title)) return null;
  return ctx.build.titleToExercise.get(title)?.exerciseId ?? null;
}

function contributingLifts(group: GroupResult, ctx: ProjectionContext, _factor: number): MuscleRankCompute["contributing"] {
  const usedTitles = new Set(group.used.map((l) => l.title));
  return group.lifts.map((l) => {
    const used = usedTitles.has(l.title);
    const reason = used
      ? null
      : group.excluded.find((e) => e.title === l.title)?.reason ?? null;
    return {
      exerciseId: liftAttribution(ctx, l.title),
      title: l.title,
      role: used ? ("used" as const) : ("excluded" as const),
      reason,
      tierIndex: liftTierIndex(l, group.group.key, 1),
      eqRatio: l.eqRatio,
      coeff: l.coeff,
      isolation: l.isolation,
      sessionsCount: l.sessionsCount,
    };
  });
}

/** Rank-state equality: tier + division + score (float-tolerant). */
export function sameRankState(a: { tierIndex: number; division: string | null; score: number }, b: { tierIndex: number; division: string | null; score: number }): boolean {
  return a.tierIndex === b.tierIndex && a.division === b.division && sameScore(a.score, b.score);
}

/** Unused import guard: RANK_TIERS re-used by tests via this module. */
export const ALL_TIERS = RANK_TIERS;