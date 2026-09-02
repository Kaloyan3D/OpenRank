/**
 * Type declarations for the untouched legacy engine copy (engine.js).
 *
 * These declarations are OURS (not upstream) and exist purely for TypeScript
 * interop with tests and the fixture generator. The .js file itself is a
 * byte-identical vendored copy of the pinned Hevy Ranks commit - see README.md.
 */
import type {
  GroupConfig,
  GroupKey,
  GroupResult,
  RankResult,
  RankTier,
  RankSex,
  RankSession,
  RankCatalog,
  RankComputeOptions,
} from "../port/types.js";

export declare const MIN_SESSIONS: number;
export declare const RANK_TIERS: readonly RankTier[];
export declare const GROUPS: Record<GroupKey, GroupConfig>;

export declare function inferGroupFromTitle(
  rawTitle: string | null | undefined,
): GroupKey | "__skip__" | null;

export declare function workoutsToSessions(workouts: unknown): RankSession[];

export declare function estimate1RM(load: unknown, reps: unknown): number;

export declare function weightForReps(oneRm: unknown, reps: unknown): number;

export declare function effectiveLoad(
  weightKg: unknown,
  type: string | null | undefined,
  bodyweightKg: number | null | undefined,
): number | null;

export declare function sexFactor(sex: string | null | undefined): number;

export declare function buildCatalog(
  templates: readonly unknown[],
): RankCatalog;

export declare function nextTierRecommendation(
  group: GroupResult,
  opts?: { bodyweightKg?: number | null },
): PortNextTierRecommendation | null;

interface PortNextTierRecommendation {
  nextTier: RankTier;
  topLift: {
    title: string;
    best1RM: number;
    coeff: number;
    currentReps: number;
  };
  required1RM: number;
  delta1RM: number;
  targetForReps: { reps: number; weight: number };
  currentForReps: { reps: number; weight: number };
  tooFar: boolean;
}

export declare function computeRanks(
  sessions: readonly RankSession[],
  catalog: RankCatalog,
  opts?: RankComputeOptions,
): RankResult;
