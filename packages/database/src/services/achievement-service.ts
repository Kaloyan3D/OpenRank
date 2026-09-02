/**
 * Phase 8: achievement read model. Collects AchievementStats once per read
 * from repositories (never writes), then evaluates the pure catalog. The
 * UI renders views; it never computes thresholds itself.
 */

import type { OpenDatabaseResult } from "../index";
import {
  evaluateAchievements,
  type AchievementStats,
  type AchievementView,
} from "./achievement-definitions";

export interface AchievementServiceDeps {
  workout: OpenDatabaseResult["workout"];
  personalRecords: OpenDatabaseResult["personalRecords"];
  rankSnapshots: OpenDatabaseResult["rankSnapshots"];
  bodyweight: OpenDatabaseResult["bodyweight"];
  /** Best-streak source (streak engine projection over the session ledger). */
  bestStreakOf: (profileId: string) => number;
}

export class AchievementService {
  constructor(private readonly deps: AchievementServiceDeps) {}

  /** Full achievement state for a profile, catalog order. */
  list(profileId: string): AchievementView[] {
    return evaluateAchievements(this.collectStats(profileId));
  }

  /** Unlocked count (profile tab summary). */
  unlockedCount(profileId: string): number {
    return this.list(profileId).filter((a) => a.unlocked).length;
  }

  private collectStats(profileId: string): AchievementStats {
    const history = this.deps.workout.listHistory(profileId);
    let cumulativeVolumeKg = 0;
    for (const detail of history) {
      for (const e of detail.exercises) {
        for (const s of e.sets) {
          if (s.completedAt == null) continue;
          cumulativeVolumeKg += (s.weightKg ?? 0) * (s.reps ?? 0);
        }
      }
    }
    const rankedGroups = new Set(
      this.deps.rankSnapshots
        .latestForProfile(profileId)
        .filter((s) => s.scopeType === "muscle")
        .map((s) => s.scopeKey),
    );
    return {
      completedWorkouts: history.length,
      cumulativeVolumeKg,
      personalRecords: this.deps.personalRecords.listForProfile(profileId).length,
      bestStreak: this.deps.bestStreakOf(profileId),
      rankedGroups: rankedGroups.size,
      bodyweightEntries: this.deps.bodyweight.history(profileId).length,
    };
  }
}
