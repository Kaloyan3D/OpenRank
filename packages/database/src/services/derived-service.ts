/**
 * DerivedDataService (Phase 5): UI-facing reads over the derived tables plus
 * the DerivedDataWorker facade. Read models NEVER feed back into canonical
 * data; if every derived row were deleted, a rebuild restores them exactly.
 */

import { weightForReps, sexFactor, GROUPS } from "@openrank/ranking-core";
import type { GroupKey } from "@openrank/ranking-core";
import type {
  PersonalRecord,
  PersonalRecordEvent,
  Profile,
  RankEvent,
  RankSnapshot,
} from "@openrank/domain";
import type { OpenDatabaseResult } from "../index";
import type { DatabaseDriver } from "../driver";
import { DerivedDataWorker } from "../derived/worker";
import type { DerivedRepos, ProcessReport } from "../derived/worker";

export interface StrengthProfileView {
  hasBodyweight: boolean;
  bodyweightKg: number | null;
  bodyweightMeasuredAt: string | null;
  groups: Array<{
    key: GroupKey;
    label: string;
    tierIndex: number | null;
    tierName: string | null;
    division: string | null;
    progress: number | null;
    score: number | null;
  }>;
}

export interface NextRankTarget {
  targetTier: string;
  targetDivision: string | null;
  required1RM: number;
  /** Example load for the current best-set rep count (estimated, not advice). */
  exampleReps: number;
  exampleTargetWeight: number | null;
  gap1RM: number;
}

export interface ExerciseRankingView {
  snapshot: RankSnapshot | null;
  provisional: boolean;
  unavailableReason: string | null;
  nextTarget: NextRankTarget | null;
  records: PersonalRecord[];
  prEvents: PersonalRecordEvent[];
  rankHistory: RankSnapshot[];
  rankEvents: RankEvent[];
}

export interface MuscleDetailView {
  snapshot: RankSnapshot | null;
  groupLabel: string;
  unavailableReason: string | null;
  contributing: Array<Record<string, unknown>>;
  recommendation: Record<string, unknown> | null;
  rankHistory: RankSnapshot[];
}

export class DerivedDataService {
  readonly worker: DerivedDataWorker;

  constructor(
    private readonly repos: OpenDatabaseResult,
    driver: DatabaseDriver,
    derived: DerivedRepos,
    opts: { now: () => string; newId: () => string },
  ) {
    this.worker = new DerivedDataWorker(driver, repos, derived, opts);
  }

  /** Consume pending dirty markers (app start repair + post-finish). */
  processPending(): ProcessReport {
    return this.worker.processPending();
  }

  /** Deterministic rebuild (correctness oracle, testing, repair). */
  rebuildAll(profileId: string): void {
    this.worker.rebuildAll(profileId);
  }

  private profile(): Profile {
    const p = this.repos.profile.getDefault();
    if (!p) throw new Error("profile not initialized");
    return p;
  }

  private latestSnapshot(profileId: string, scopeType: "exercise" | "muscle", scopeKey: string): RankSnapshot | null {
    return this.repos.rankSnapshots.latest(profileId, scopeType, scopeKey);
  }

  /** Ranks tab primary view (spec Y): six muscle groups, NO overall rank. */
  getStrengthProfile(profileId: string): StrengthProfileView {
    const entry = this.repos.bodyweight.history(profileId)[0] ?? null;
    const latest = new Map(
      this.repos.rankSnapshots
        .latestForProfile(profileId)
        .filter((s: RankSnapshot) => s.scopeType === "muscle")
        .map((s: RankSnapshot) => [s.scopeKey, s] as const),
    );
    const groups = (Object.keys(GROUPS) as GroupKey[]).map((key) => {
      const snap = latest.get(key);
      return {
        key,
        label: GROUPS[key].label,
        tierIndex: snap ? snap.tierIndex : null,
        tierName: snap ? snap.tierName : null,
        division: snap ? snap.division : null,
        progress: snap ? snap.progress : null,
        score: snap ? snap.score : null,
      };
    });
    return {
      hasBodyweight: entry != null,
      bodyweightKg: entry ? entry.weightKg : null,
      bodyweightMeasuredAt: entry ? entry.measuredAt : null,
      groups,
    };
  }

  /** Muscle-group detail (spec Z): transparency over the aggregation. */
  getMuscleDetail(profileId: string, groupKey: GroupKey): MuscleDetailView {
    const snapshot = this.latestSnapshot(profileId, "muscle", groupKey);
    const details = snapshot ? (JSON.parse(snapshot.detailsJson) as Record<string, unknown>) : {};
    return {
      snapshot,
      groupLabel: GROUPS[groupKey].label,
      unavailableReason: snapshot ? null : "no_data",
      contributing: (details.contributing as Array<Record<string, unknown>>) ?? [],
      recommendation: (details.recommendation as Record<string, unknown> | null) ?? null,
      rankHistory: this.repos.rankSnapshots.history(profileId, "muscle", groupKey),
    };
  }

  /** Exercise detail ranking/PR view (spec AA/AC). */
  getExerciseRanking(profileId: string, exerciseId: string): ExerciseRankingView {
    const exercise = this.repos.exercise.findById(exerciseId);
    const snapshot = this.latestSnapshot(profileId, "exercise", exerciseId);
    const profile = this.profile();
    const nextTarget = snapshot ? this.nextTargetFor(profile.strengthStandard, snapshot) : null;
    const rankEvents = this.repos.rankEvents
      .historyForScope(profileId, "exercise", exerciseId);
    return {
      snapshot,
      provisional: snapshot ? (JSON.parse(snapshot.detailsJson).provisional === true) : false,
      unavailableReason: !exercise
        ? "unknown_exercise"
        : exercise.rankingEligibility === "unsupported"
          ? "unsupported"
          : snapshot
            ? null
            : this.repos.bodyweight.resolve(profileId, new Date().toISOString())
              ? "no_qualifying_data"
              : "no_bodyweight",
      nextTarget,
      records: this.repos.personalRecords.listForExercise(profileId, exerciseId),
      prEvents: this.repos.personalRecords.listEventsForExercise(profileId, exerciseId),
      rankHistory: this.repos.rankSnapshots.history(profileId, "exercise", exerciseId),
      rankEvents,
    };
  }

  /**
   * Next-rank target (spec O): reverse-Epley translation of the next tier
   * threshold into an estimated load at the current best-set rep count.
   * An ESTIMATE corresponding to the ranking threshold - not a prescription.
   */
  private nextTargetFor(strengthStandard: string, snapshot: RankSnapshot): NextRankTarget | null {
    if (snapshot.scopeType !== "exercise") return null;
    const details = JSON.parse(snapshot.detailsJson) as {
      engineGroup?: string;
      coefficient?: number;
      bestSet?: { e1rm: number; effectiveLoadKg: number; reps: number };
      provisional?: boolean;
    };
    const groupKey = details.engineGroup as GroupKey | undefined;
    if (!groupKey || !details.bestSet) return null;
    const group = GROUPS[groupKey];
    if (!group) return null;
    if (snapshot.tierIndex >= group.thresholds.length - 1) return null; // Mythic
    const factor = sexFactor(strengthStandard);
    const bw = this.repos.bodyweight.resolve(snapshot.profileId, snapshot.calculatedAt)?.weightKg ?? null;
    if (bw == null || bw <= 0) return null;
    const coeff = Number(details.coefficient ?? 1);
    const requiredRatio = (group.thresholds[snapshot.tierIndex + 1] ?? 0) * factor;
    const required1RM = requiredRatio * coeff * bw;
    const reps = Math.max(1, Math.min(10, Math.round(details.bestSet.reps || 5)));
    return {
      targetTier: this.nextTierName(snapshot.tierIndex),
      targetDivision: "IV",
      required1RM,
      exampleReps: reps,
      exampleTargetWeight: weightForReps(required1RM, reps),
      gap1RM: required1RM - details.bestSet.e1rm,
    };
  }

  private nextTierName(tierIndex: number): string {
    const names = ["Bronze", "Iron", "Gold", "Platinum", "Diamond", "Titan", "Colossus", "Olympian", "Mythic"];
    return names[Math.min(names.length - 1, tierIndex + 1)] as string;
  }

  /** Workout summary highlights (spec X): PRs + rank-ups of this workout. */
  getWorkoutHighlights(workoutId: string): { prs: PersonalRecordEvent[]; rankUps: RankEvent[]; rankDowns: RankEvent[] } {
    return {
      prs: this.repos.personalRecords.listEventsForWorkout(workoutId),
      rankUps: this.repos.rankEvents.listForWorkout(workoutId).filter((e: RankEvent) => e.direction === "up"),
      rankDowns: this.repos.rankEvents.listForWorkout(workoutId).filter((e: RankEvent) => e.direction === "down"),
    };
  }

  /** Recent transitions for the Ranks tab (spec Y). */
  recentRankEvents(profileId: string, limit = 20): RankEvent[] {
    return this.repos.rankEvents.listForProfile(profileId, limit);
  }
}