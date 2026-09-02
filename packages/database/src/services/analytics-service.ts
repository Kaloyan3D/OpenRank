/**
 * Phase 8: analytics read models. Deterministic, REBUILDABLE projections
 * over canonical workout data (spec 69): every series is derived on read
 * from repositories - nothing here is canonical, nothing here writes, and
 * no rank math happens outside the derived engines. Charts consume these
 * point lists directly; the UI never issues SQL and never computes ranks.
 */

import type { OpenDatabaseResult } from "../index";
import type { BodyweightEntry, PersonalRecordEvent, RankScopeType, RankSnapshot } from "@openrank/domain";
import { isoWeekKey, startOfIsoWeek, addDays } from "./iso-week";

/** One bodyweight measurement, chronological. */
export interface BodyweightPoint {
  at: string;
  weightKg: number;
}

/** Best-e1RM progression for one exercise (each point is a new PR event). */
export interface E1rmPoint {
  at: string;
  e1rmKg: number;
  previousValue: number | null;
  sourceWorkoutId: string;
}

/** Rank score over time for one scope (exercise or muscle group). */
export interface RankTimelinePoint {
  at: string;
  score: number;
  tierIndex: number;
  tierName: string;
  division: string | null;
  progress: number | null;
  sourceWorkoutId: string;
}

/** ISO-week training activity bucket (canonical completed workouts only). */
export interface WeeklyActivityBucket {
  /** ISO week key of the bucket's start date, e.g. "2026-W07". */
  weekKey: string;
  /** YYYY-MM-DD of the bucket's ISO-week Monday. */
  weekStart: string;
  workouts: number;
  completedSets: number;
  volumeKg: number;
}

/** Per-exercise completed volume inside one workout (summary charts). */
export interface WorkoutVolumeSlice {
  exerciseId: string;
  exerciseName: string | null;
  volumeKg: number;
  completedSets: number;
}

/** Muscle-group rank state + how much history exists for it. */
export interface StrengthProfileGroupSummary {
  key: string;
  label: string;
  tierName: string | null;
  division: string | null;
  score: number | null;
  progress: number | null;
  snapshotCount: number;
}

export interface AnalyticsServiceRepos {
  bodyweight: OpenDatabaseResult["bodyweight"];
  personalRecords: OpenDatabaseResult["personalRecords"];
  rankSnapshots: OpenDatabaseResult["rankSnapshots"];
  workout: OpenDatabaseResult["workout"];
}

export class AnalyticsService {
  constructor(
    private readonly repos: AnalyticsServiceRepos,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private requireDetail(workoutId: string) {
    const detail = this.repos.workout.getById(workoutId);
    if (detail == null) throw new Error("workout not found: " + workoutId);
    return detail;
  }

  private workoutSummaryOf(workoutId: string): { completedSetCount: number; volumeKg: number; durationSeconds: number } {
    const detail = this.requireDetail(workoutId);
    let completedSetCount = 0;
    let volumeKg = 0;
    for (const e of detail.exercises) {
      for (const s of e.sets) {
        if (s.completedAt == null) continue;
        completedSetCount += 1;
        volumeKg += (s.weightKg ?? 0) * (s.reps ?? 0);
      }
    }
    const finishedAt = detail.workout.finishedAt;
    const durationSeconds =
      finishedAt != null
        ? Math.max(0, Math.floor((Date.parse(finishedAt) - Date.parse(detail.workout.startedAt)) / 1000))
        : 0;
    return { completedSetCount, volumeKg, durationSeconds };
  }

  /** Bodyweight measurements, chronological ascending (chart input). */
  bodyweightSeries(profileId: string): BodyweightPoint[] {
    return this.repos.bodyweight
      .history(profileId)
      .slice()
      .reverse()
      .map((e: BodyweightEntry) => ({ at: e.measuredAt, weightKg: e.weightKg }));
  }

  /**
   * e1RM progression = the max_e1RM personal-record event stream, ascending.
   * Each event is a new verified best, so the series is the honest step
   * function of the athlete's progression (non-PR sessions add no point).
   */
  e1rmProgression(profileId: string, exerciseId: string, limit = 100): E1rmPoint[] {
    const events: PersonalRecordEvent[] = this.repos.personalRecords
      .listEventsForExercise(profileId, exerciseId, limit)
      .filter((e) => e.recordType === "max_e1rm")
      .slice()
      .reverse();
    return events.map((e) => ({
      at: e.achievedAt,
      e1rmKg: e.value,
      previousValue: e.previousValue,
      sourceWorkoutId: e.sourceWorkoutId,
    }));
  }

  /** Rank snapshots for one scope, chronological (timeline charts). */
  rankTimeline(profileId: string, scopeType: RankScopeType, scopeKey: string): RankTimelinePoint[] {
    const history: RankSnapshot[] = this.repos.rankSnapshots.history(profileId, scopeType, scopeKey);
    return history.map((s) => ({
      at: s.calculatedAt,
      score: s.score,
      tierIndex: s.tierIndex,
      tierName: s.tierName,
      division: s.division,
      progress: s.progress,
      sourceWorkoutId: s.sourceWorkoutId,
    }));
  }

  /**
   * Weekly training activity over the trailing window INCLUDING the current
   * ISO week. Buckets are keyed by the ISO week of each workout's canonical
   * start instant (UTC date part) - deterministic regardless of device
   * timezone. Only completed workouts count.
   */
  weeklyActivity(profileId: string, weeks = 12): WeeklyActivityBucket[] {
    const nowDate = this.now().slice(0, 10);
    const currentWeekStart = startOfIsoWeek(nowDate);
    const byKey = new Map<string, WeeklyActivityBucket>();
    for (let i = weeks - 1; i >= 0; i--) {
      const weekStart = addDays(currentWeekStart, -7 * i);
      const key = isoWeekKey(weekStart);
      byKey.set(key, { weekKey: key, weekStart, workouts: 0, completedSets: 0, volumeKg: 0 });
    }
    const history = this.repos.workout.listHistory(profileId);
    for (const detail of history) {
      const key = isoWeekKey(detail.workout.startedAt.slice(0, 10));
      const bucket = byKey.get(key);
      if (!bucket) continue;
      bucket.workouts += 1;
      const summary = this.workoutSummaryOf(detail.workout.id);
      bucket.completedSets += summary.completedSetCount;
      bucket.volumeKg += summary.volumeKg;
    }
    return [...byKey.values()];
  }

  /**
   * Completed-volume breakdown per exercise for one workout (summary bar
   * chart). Completed sets only - identical rule to the canonical summary.
   */
  workoutVolumeBreakdown(workoutId: string, nameOf?: (exerciseId: string) => string | null): WorkoutVolumeSlice[] {
    const detail = this.requireDetail(workoutId);
    const slices: WorkoutVolumeSlice[] = [];
    for (const e of detail.exercises) {
      let volumeKg = 0;
      let completedSets = 0;
      for (const s of e.sets) {
        if (s.completedAt == null) continue;
        completedSets += 1;
        volumeKg += (s.weightKg ?? 0) * (s.reps ?? 0);
      }
      slices.push({
        exerciseId: e.workoutExercise.exerciseId,
        exerciseName: nameOf ? nameOf(e.workoutExercise.exerciseId) : null,
        volumeKg,
        completedSets,
      });
    }
    return slices;
  }

  /**
   * Strength-profile read model for the analytics hub: latest rank per
   * muscle group plus how many snapshots exist (history depth).
   */
  strengthProfileSummary(profileId: string, groupLabels: ReadonlyMap<string, string>): StrengthProfileGroupSummary[] {
    const latest = this.repos.rankSnapshots.latestForProfile(profileId).filter((s) => s.scopeType === "muscle");
    return latest
      .map((s) => ({
        key: s.scopeKey,
        label: groupLabels.get(s.scopeKey) ?? s.scopeKey,
        tierName: s.tierName,
        division: s.division,
        score: s.score,
        progress: s.progress,
        snapshotCount: this.repos.rankSnapshots.history(profileId, "muscle", s.scopeKey).length,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
}
