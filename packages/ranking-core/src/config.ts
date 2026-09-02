/**
 * Overall-rank architecture (spec section 15).
 *
 * The interface exists NOW so services and UI can be written against it, but
 * the calculation stays disabled until a deliberate overall-strength
 * calibration is designed and tested. Do not casually average six muscle
 * ranks. Until enabled, the UI displays a "Strength Profile".
 */
import type { GroupKey, GroupResult, RankSex, RankTier } from "./port/types.js";
import { RANKING_VERSION } from "./version.js";

export interface OverallRankInput {
  profileId: string;
  groups: Record<GroupKey, GroupResult>;
  bodyweightKg: number;
  sex: RankSex;
}

export interface OverallRankResult {
  tierIndex: number;
  tier: RankTier;
  /** Composite overall score (calibration TBD while disabled). */
  score: number;
  /** 0..1 progress toward the next tier. */
  progress: number;
  rankingVersion: string;
}

export interface OverallRankCalculator {
  calculate(input: OverallRankInput): OverallRankResult;
}

export const RANKING_CONFIG = {
  overallRankEnabled: false,
  /** Version stamped into snapshots produced by the disabled calculator. */
  rankingVersion: RANKING_VERSION,
} as const;
