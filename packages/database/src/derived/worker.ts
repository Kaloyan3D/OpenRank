/**
 * DerivedDataWorker (Phase 5, spec P-U): consumes the derived_dirty queue and
 * maintains the personal-record + rank projections.
 *
 * Safety pattern (spec P) - markers are deleted ATOMICALLY with the
 * projection writes they produced:
 *
 *   BEGIN
 *     read canonical state + markers (consistent read on one connection)
 *     compute projections (pure JS)
 *     write projections/events (keyed, idempotent upserts)
 *     delete satisfied markers
 *   COMMIT
 *
 * A crash before COMMIT rolls everything back - markers survive and the work
 * is retried (restart-safe, retry-safe). A processing ERROR is caught per
 * profile and reported; markers remain (failure leaves retry intent) and
 * canonical data is never touched by this worker.
 *
 * Idempotency (spec U): every write is a keyed upsert/replacement; running
 * the same canonical state twice produces the same current records, the same
 * snapshot count and the same event count.
 *
 * Two paths, ONE shared step function (so incremental == rebuild by
 * construction, spec R):
 * - processPending: workout markers -> walk the marked COMPLETED workouts
 *   chronologically (PR deltas against current best rows; rank state per
 *   workout against the latest snapshot). Profile-level markers
 *   (bodyweight_changed / profile_changed) escalate to a full rebuild
 *   (spec I/T: historical invalidation is never locally patched).
 * - rebuildAll(profileId): clear the profile's derived rows, then walk ALL
 *   completed workouts chronologically through the same step function.
 *
 * Markers for non-completed workouts are consumed without projection: an
 * active workout cannot affect PRs/ranks, and completing it writes fresh
 * markers (workout_completed + workout_saved).
 */

import { computeRanks, RANKING_VERSION } from "@openrank/ranking-core";
import type {
  PersonalRecord,
  PersonalRecordEvent,
  PersonalRecordRepository,
  RankEvent,
  RankEventRepository,
  RankSnapshot,
  RankSnapshotRepository,
} from "@openrank/domain";
import type { WorkoutDetail } from "@openrank/domain";
import type { DatabaseDriver, SqlParam } from "../driver";
import type { OpenDatabaseResult } from "../index";
import { ENGINE_VERSION, PROJECTION_VERSION } from "./divisions";
import { isImprovement, prCandidatesForSet } from "./pr-engine";
import { RankingInputBuilder } from "./ranking-input";
import type { ProjectionContext, RankState } from "./projection";
import { projectExerciseRanks, projectMuscleRanks, sameRankState } from "./projection";

export interface DerivedRepos {
  personalRecords: PersonalRecordRepository;
  rankSnapshots: RankSnapshotRepository;
  rankEvents: RankEventRepository;
}

export interface ProcessReport {
  /** Markers consumed (projection written or provably nothing to do). */
  processedMarkers: number;
  /** Completed-workout projection steps executed. */
  workoutsProcessed: number;
  /** Profiles that went through the full-rebuild path. */
  profilesRebuilt: number;
  /** Per-profile processing failures (markers retained for retry). */
  errors: Array<{ profileId: string | null; message: string }>;
}

interface WorkerOptions {
  now: () => string;
  newId: () => string;
}

interface ProfileBuilds {
  rankable: ReturnType<RankingInputBuilder["build"]>;
  eligibleOnly: ReturnType<RankingInputBuilder["build"]>;
}

export class DerivedDataWorker {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly repos: OpenDatabaseResult,
    private readonly derived: DerivedRepos,
    private readonly opts: WorkerOptions,
  ) {}

  /** Consume all pending markers. Never throws: failures are reported. */
  processPending(): ProcessReport {
    const report: ProcessReport = { processedMarkers: 0, workoutsProcessed: 0, profilesRebuilt: 0, errors: [] };
    const markers = this.repos.dirty.list();
    if (markers.length === 0) return report;

    // Coalesce (spec Q): one processing unit per profile. Set/exercise
    // markers carry a null profile (they are written per entity); resolve
    // them to their owning workout's profile so they are processed, not
    // dropped.
    const byProfile = new Map<string, typeof markers>();
    const unresolvable: string[] = [];
    for (const m of markers) {
      let profileId = m.profileId;
      if (profileId == null) {
        const workoutId = this.workoutOfEntity(m.entityType, m.entityId);
        if (workoutId) {
          const row = this.driver.get("SELECT profile_id FROM workouts WHERE id = ?", [workoutId]);
          profileId = row && row.profile_id != null ? String(row.profile_id) : null;
        }
      }
      if (profileId == null) {
        unresolvable.push(m.id);
        continue;
      }
      let list = byProfile.get(profileId);
      if (!list) {
        list = [];
        byProfile.set(profileId, list);
      }
      list.push(m);
    }

    for (const [profileId, profileMarkers] of byProfile) {
      try {
        const profileLevel = profileMarkers.some(
          (m) => m.reason === "bodyweight_changed" || m.reason === "profile_changed",
        );
        const workoutIds = new Set<string>();
        for (const m of profileMarkers) {
          if (m.entityType === "workout") {
            workoutIds.add(m.entityId);
          } else if (m.entityType === "workout_set" || m.entityType === "workout_exercise") {
            const w = this.workoutOfEntity(m.entityType, m.entityId);
            if (w) workoutIds.add(w);
          }
        }
        if (profileLevel) {
          this.rebuildAll(profileId);
          report.profilesRebuilt += 1;
        } else {
          report.workoutsProcessed += this.processWorkouts(profileId, workoutIds);
        }
        // Atomically drop every marker this unit satisfied.
        this.repos.dirty.clear(profileMarkers.map((m) => m.id));
        report.processedMarkers += profileMarkers.length;
      } catch (err) {
        report.errors.push({
          profileId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Unresolvable markers (entity deleted before processing) have nothing
    // to project: drop them safely.
    if (unresolvable.length > 0) this.repos.dirty.clear(unresolvable);

    return report;
  }

  /**
   * Deterministic full rebuild (spec R): clear the profile's derived rows,
   * then walk ALL completed workouts chronologically through the same step
   * function the incremental path uses. The correctness oracle.
   */
  rebuildAll(profileId: string): void {
    this.driver.transaction(() => {
      this.derived.personalRecords.replaceAllForProfile(profileId, []);
      this.derived.personalRecords.replaceAllEventsForProfile(profileId, []);
      this.derived.rankSnapshots.replaceAllForProfile(profileId, []);
      this.derived.rankEvents.replaceAllForProfile(profileId, []);
      const builds = this.prepareBuilds(profileId);
      const details = this.completedWorkouts(profileId, null);
      for (const detail of details) this.step(profileId, detail, builds);
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private workoutOfEntity(entityType: string, entityId: string): string | null {
    if (entityType === "workout") return entityId;
    if (entityType === "workout_exercise") {
      const row = this.driver.get("SELECT workout_id FROM workout_exercises WHERE id = ?", [entityId]);
      return row ? String(row.workout_id) : null;
    }
    const row = this.driver.get(
      "SELECT we.workout_id AS workout_id FROM workout_sets s " +
        "JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE s.id = ?",
      [entityId],
    );
    return row ? String(row.workout_id) : null;
  }

  private completedWorkouts(profileId: string, onlyIds: Set<string> | null): WorkoutDetail[] {
    const params: SqlParam[] = [profileId];
    let sql =
      "SELECT id FROM workouts WHERE profile_id = ? AND status = 'completed' ";
    if (onlyIds) {
      const ids = [...onlyIds];
      if (ids.length === 0) return [];
      sql += "AND id IN (" + ids.map(() => "?").join(",") + ") ";
      params.push(...ids);
    }
    sql += "ORDER BY started_at, id";
    const rows = this.driver.all(sql, params) as Record<string, unknown>[];
    const out: WorkoutDetail[] = [];
    for (const row of rows) {
      const detail = this.repos.workout.getById(String(row.id));
      if (detail) out.push(detail);
    }
    return out;
  }

  /** Incremental path: walk the given completed workouts chronologically. */
  private processWorkouts(profileId: string, workoutIds: Set<string>): number {
    if (workoutIds.size === 0) return 0;
    let processed = 0;
    this.driver.transaction(() => {
      const details = this.completedWorkouts(profileId, workoutIds);
      const builds = this.prepareBuilds(profileId);
      for (const detail of details) {
        this.step(profileId, detail, builds);
        processed += 1;
      }
    });
    return processed;
  }

  private prepareBuilds(profileId: string): ProfileBuilds {
    const builder = new RankingInputBuilder(this.driver);
    return {
      rankable: builder.build(profileId, "rankable"),
      eligibleOnly: builder.build(profileId, "eligible_only"),
    };
  }

  /**
   * THE shared projection step for one completed workout. Both paths run
   * exactly this code against the same within-transaction state, so their
   * results are equal by construction.
   */
  private step(profileId: string, detail: WorkoutDetail, builds: ProfileBuilds): void {
    const workout = detail.workout;
    const now = this.opts.now();

    // ---- Personal records (spec J) ----------------------------------------
    const bwEntry = this.repos.bodyweight.resolve(profileId, workout.startedAt);
    const bwKg = bwEntry ? bwEntry.weightKg : null;
    for (const block of detail.exercises) {
      const exercise = this.repos.exercise.findById(block.workoutExercise.exerciseId);
      if (!exercise) continue;
      for (const set of block.sets) {
        if (set.completedAt == null || set.setType === "warmup") continue;
        for (const candidate of prCandidatesForSet(exercise.trackingType, set, bwKg)) {
          const best = this.derived.personalRecords.best(
            profileId, block.workoutExercise.exerciseId, candidate.recordType, candidate.qualifierKey,
          );
          if (!isImprovement(candidate.value, best ? best.value : null)) continue;
          const record: PersonalRecord = {
            id: best ? best.id : this.opts.newId(),
            profileId,
            exerciseId: block.workoutExercise.exerciseId,
            recordType: candidate.recordType,
            qualifierKey: candidate.qualifierKey,
            value: candidate.value,
            sourceReps: candidate.sourceReps,
            sourceSetId: set.id,
            sourceWorkoutId: workout.id,
            achievedAt: set.completedAt,
            createdAt: best ? best.createdAt : now,
            updatedAt: now,
          };
          this.derived.personalRecords.upsertBest(record);
          const event: PersonalRecordEvent = {
            id: this.opts.newId(),
            profileId,
            exerciseId: block.workoutExercise.exerciseId,
            recordType: candidate.recordType,
            qualifierKey: candidate.qualifierKey,
            previousValue: best ? best.value : null,
            value: candidate.value,
            sourceSetId: set.id,
            sourceWorkoutId: workout.id,
            achievedAt: set.completedAt,
            createdAt: now,
          };
          this.derived.personalRecords.appendEvent(event);
        }
      }
    }

    // ---- Ranks (spec L/M) --------------------------------------------------
    if (!builds.rankable.workoutHasRankRelevantSets.get(workout.id)) return;

    const profile = this.repos.profile.getDefault();
    if (!profile) return;

    // Session prefix: every completed workout up to and INCLUDING this one,
    // matched by workout identity (the engine works on day-granular dates;
    // identity-based prefixes keep same-day workouts ordered correctly).
    const idx = builds.rankable.sessionWorkoutIds.lastIndexOf(workout.id);
    if (idx < 0) return;
    const rankableSessions = builds.rankable.sessions.slice(0, idx + 1);
    const eligibleSessions = builds.eligibleOnly.sessions.slice(0, idx + 1);

    const ctxBase = {
      profileId,
      strengthStandard: profile.strengthStandard,
      bodyweightKg: bwEntry ? bwEntry.weightKg : null,
      bodyweightEntryId: bwEntry ? bwEntry.id : null,
    };
    const rankableResult = computeRanks(rankableSessions, builds.rankable.catalog, {
      bodyweightKg: ctxBase.bodyweightKg,
      sex: profile.strengthStandard,
    });
    const eligibleResult = computeRanks(eligibleSessions, builds.eligibleOnly.catalog, {
      bodyweightKg: ctxBase.bodyweightKg,
      sex: profile.strengthStandard,
    });

    const ctxRankable: ProjectionContext = { ...ctxBase, build: builds.rankable };
    const ctxEligible: ProjectionContext = { ...ctxBase, build: builds.eligibleOnly };
    const exerciseStates = projectExerciseRanks(ctxRankable, rankableResult);
    const muscleStates = projectMuscleRanks(ctxEligible, eligibleResult);

    const emitState = (state: RankState, previous: RankSnapshot | null, provisional: boolean) => {
      const snapshot: RankSnapshot = {
        id: this.opts.newId(),
        profileId,
        scopeType: state.scopeType,
        scopeKey: state.scopeKey,
        tierIndex: state.tierIndex,
        tierName: state.tierName,
        division: state.division,
        score: state.score,
        progress: state.progress,
        rankingVersion: RANKING_VERSION,
        projectionVersion: PROJECTION_VERSION,
        calculatedAt: workout.finishedAt ?? workout.startedAt,
        sourceWorkoutId: workout.id,
        detailsJson: JSON.stringify({ ...state.details, provisional }),
      };
      this.derived.rankSnapshots.upsert(snapshot);

      // Transition events: only when a previous state existed and the tier
      // changed (first appearance is a snapshot, not a transition). Both
      // directions are recorded (spec D: ranks can legitimately drop).
      if (previous && previous.tierIndex !== state.tierIndex) {
        const direction = state.tierIndex > previous.tierIndex ? "up" : "down";
        const event: RankEvent = {
          id: this.opts.newId(),
          profileId,
          scopeType: state.scopeType,
          scopeKey: state.scopeKey,
          fromTierIndex: previous.tierIndex,
          fromTier: previous.tierName,
          fromDivision: previous.division,
          toTierIndex: state.tierIndex,
          toTier: state.tierName,
          toDivision: state.division,
          direction,
          score: state.score,
          rankingVersion: RANKING_VERSION,
          projectionVersion: PROJECTION_VERSION,
          sourceWorkoutId: workout.id,
          createdAt: now,
        };
        this.derived.rankEvents.append(event);
      }
    };

    for (const compute of exerciseStates.values()) {
      if (!compute.state) continue;
      const previous = this.derived.rankSnapshots.latest(profileId, "exercise", compute.state.scopeKey);
      if (previous && sameRankState(previous, compute.state)) continue;
      emitState(compute.state, previous, compute.provisional);
    }
    for (const compute of muscleStates.values()) {
      if (!compute.state) continue;
      const previous = this.derived.rankSnapshots.latest(profileId, "muscle", compute.state.scopeKey);
      if (previous && sameRankState(previous, compute.state)) continue;
      emitState(compute.state, previous, false);
    }
  }
}

export { ENGINE_VERSION };