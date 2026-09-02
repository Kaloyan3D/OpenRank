import { describe, expect, it } from "vitest";
import { openTestDb } from "../testing/helpers";
import type { OpenDatabaseResult } from "../index";
import type { DatabaseDriver } from "../driver";
import { createServices } from "./index";
import type { OpenRankServices } from "./index";
import { ActiveWorkoutConflictError, IncompleteSetsError } from "./errors";

/** Fixed clock: 2026-02-01T10:00:00Z, advancing by N seconds per call. */
function testClock(startIso: string) {
  let ms = Date.parse(startIso);
  return () => {
    const iso = new Date(ms).toISOString();
    ms += 1000;
    return iso;
  };
}

function setup(db: { driver: DatabaseDriver; repos: OpenDatabaseResult }, startIso: string) {
  const now = testClock(startIso);
  const services: OpenRankServices = createServices(db.driver, db.repos, { now });
  const profile = db.repos.profile.ensureDefault();
  return { ...services, profile, now };
}

describe("WorkoutService - session model", () => {
  it("starts an empty workout with logical date, offset and resume", () => {
    const db = openTestDb(false);
    const { workout, profile } = setup(db, "2026-02-02T01:30:00.000Z"); // before 04:00
    const w = workout.startEmptyWorkout(profile.id, { timezoneOffsetMinutes: 0 });
    expect(w.status).toBe("active");
    expect(w.startLocalDate).toBe("2026-02-02");
    expect(w.logicalTrainingDate).toBe("2026-02-01"); // 04:00 boundary
    const resumed = workout.resumeActiveWorkout(profile.id);
    expect(resumed?.workout.id).toBe(w.id);
  });

  it("refuses to silently start a second workout (structured conflict)", () => {
    const db = openTestDb(false);
    const { workout, profile } = setup(db, "2026-02-01T10:00:00.000Z");
    const first = workout.startEmptyWorkout(profile.id);
    let conflict: ActiveWorkoutConflictError | null = null;
    try {
      workout.startEmptyWorkout(profile.id);
    } catch (err) {
      conflict = err as ActiveWorkoutConflictError;
    }
    expect(conflict).toBeInstanceOf(ActiveWorkoutConflictError);
    expect(conflict?.activeWorkoutId).toBe(first.id);
    // The active workout is untouched.
    expect(workout.resumeActiveWorkout(profile.id)?.workout.id).toBe(first.id);
  });

  it("starts from a routine: snapshot copies order, rest, supersets and targets", () => {
    const db = openTestDb();
    const { workout, routine, profile } = setup(db, "2026-02-01T10:00:00.000Z");
    const squat = db.repos.exercise.resolveAlias("Squat (Barbell)")!;
    const bench = db.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const r = routine.create(profile.id, "Push Day");
    routine.addExercise(r.id, {
      exerciseId: bench.id,
      restSeconds: 150,
      supersetGroup: null,
      targets: [{ setType: "normal", targetRepsMin: 6, targetRepsMax: 8, targetWeightKg: 80 }],
    });
    routine.addExercise(r.id, { exerciseId: squat.id, restSeconds: 180, supersetGroup: "A" });
    const w = workout.startWorkoutFromRoutine(profile.id, r.id);
    expect(w.routineId).toBe(r.id);
    expect(w.title).toBe("Push Day");
    const detail = db.repos.workout.getById(w.id)!;
    expect(detail.exercises.map((e) => e.workoutExercise.exerciseId)).toEqual([bench.id, squat.id]);
    expect(detail.exercises[0]!.workoutExercise.restSeconds).toBe(150);
    expect(detail.exercises[1]!.workoutExercise.supersetGroup).toBe("A");
    expect(detail.exercises[0]!.workoutExercise.targetSets).toEqual([
      { setType: "normal", targetRepsMin: 6, targetRepsMax: 8, targetWeightKg: 80, targetRpe: null, targetRir: null },
    ]);
    expect(detail.exercises[1]!.workoutExercise.targetSets).toBeNull();
  });

  it("later routine edits never mutate an already-started workout (snapshot semantics)", () => {
    const db = openTestDb();
    const { workout, routine, profile } = setup(db, "2026-02-01T10:00:00.000Z");
    const squat = db.repos.exercise.resolveAlias("Squat (Barbell)")!;
    const bench = db.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const r = routine.create(profile.id, "Push Day");
    const reBench = routine.addExercise(r.id, { exerciseId: bench.id, restSeconds: 150 });
    routine.addExercise(r.id, { exerciseId: squat.id, restSeconds: 180 });
    routine.setTargets(reBench.id, [{ setType: "normal", targetRepsMin: 6, targetRepsMax: 8 }]);
    const w = workout.startWorkoutFromRoutine(profile.id, r.id);

    // Edit the routine AFTER starting: rename, reorder, change rest, targets, add exercise.
    routine.rename(r.id, "Push Day HEAVY");
    routine.setRestSeconds(reBench.id, 300);
    routine.setTargets(reBench.id, [{ setType: "failure", targetRepsMin: 3 }]);
    routine.reorderExercises(r.id, [detailSquat(db, r.id)!, reBench.id]);
    routine.addExercise(r.id, { exerciseId: squat.id, restSeconds: 60 });

    const after = db.repos.workout.getById(w.id)!;
    expect(after.workout.title).toBe("Push Day"); // snapshot title, not renamed
    expect(after.exercises.map((e) => e.workoutExercise.exerciseId)).toEqual([bench.id, squat.id]);
    expect(after.exercises[0]!.workoutExercise.restSeconds).toBe(150);
    expect(after.exercises[0]!.workoutExercise.targetSets).toEqual([
      { setType: "normal", targetRepsMin: 6, targetRepsMax: 8, targetWeightKg: null, targetRpe: null, targetRir: null },
    ]);
    expect(after.exercises).toHaveLength(2);
  });

  it("finishes a workout: validation, completion, rest-timer clear, summary", () => {
    const db = openTestDb();
    const { workout, profile } = setup(db, "2026-02-01T10:00:00.000Z");
    const bench = db.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const w = workout.startEmptyWorkout(profile.id);
    const we = db.repos.workout.addExercise(w.id, { exerciseId: bench.id, restSeconds: 120 });
    workout.addSet(we.id, { setType: "normal", weightKg: 102.5, reps: 6 });
    workout.addSet(we.id, { setType: "normal", weightKg: 102.5, reps: 5 });
    workout.addSet(we.id, { setType: "normal", weightKg: 102.5, reps: 5 });
    const sets = db.repos.workout.getById(w.id)!.exercises[0]!.sets;
    workout.completeSet(sets[0]!.id);
    workout.completeSet(sets[1]!.id);
    db.repos.workout.addExercise(w.id, { exerciseId: bench.id }); // second block, incomplete set
    // Timer running from the last completion.
    expect((workout as unknown as { restTimer: { getActive(id: string): unknown } }).restTimer.getActive(profile.id)).not.toBeNull();

    // Reject policy surfaces incomplete rows.
    expect(() => workout.finishWorkout(w.id, { incompleteSetPolicy: "reject" })).toThrow(IncompleteSetsError);

    const summary = workout.finishWorkout(w.id, { incompleteSetPolicy: "remove", finishedAtUtc: "2026-02-01T10:57:00.000Z" });
    expect(summary.workout.status).toBe("completed");
    expect(summary.completedSetCount).toBe(2);
    expect(summary.exerciseCount).toBe(2);
    expect(summary.totalSetCount).toBe(2); // incomplete removed
    expect(summary.volumeKg).toBeCloseTo(102.5 * 6 + 102.5 * 5);
    expect(summary.durationSeconds).toBe(57 * 60);
    // Rest timer cleared by finishing.
    expect((workout as unknown as { restTimer: { getActive(id: string): unknown } }).restTimer.getActive(profile.id)).toBeNull();
    // No longer active; completing again fails.
    expect(workout.resumeActiveWorkout(profile.id)).toBeNull();
  });

  it("discards a workout permanently (cascade + dirty marker cleanup + timer clear)", () => {
    const db = openTestDb();
    const { workout, profile } = setup(db, "2026-02-01T10:00:00.000Z");
    const squat = db.repos.exercise.resolveAlias("Squat (Barbell)")!;
    const w = workout.startEmptyWorkout(profile.id);
    const we = db.repos.workout.addExercise(w.id, { exerciseId: squat.id });
    const s = workout.addSet(we.id, { setType: "normal", weightKg: 140, reps: 5 });
    workout.completeSet(s.id);
    (workout as unknown as { restTimer: { start(profileId: string, workoutId: string, seconds: number): void } }).restTimer.start(profile.id, w.id, 90);
    const dirtyBefore = db.repos.dirty.count();
    expect(dirtyBefore).toBeGreaterThan(0);

    workout.discardWorkout(w.id);
    expect(db.repos.workout.getById(w.id)).toBeNull();
    // Only profile-level markers remain; workout + set markers are gone.
    const markers = db.repos.dirty.list();
    expect(markers.filter((m) => m.entityType === "workout" || m.entityType === "workout_set")).toHaveLength(0);
    expect((workout as unknown as { restTimer: { getActive(id: string): unknown } }).restTimer.getActive(profile.id)).toBeNull();
    // Profile can start a new workout immediately.
    expect(() => workout.startEmptyWorkout(profile.id)).not.toThrow();
  });

  it("history lists completed workouts newest-first and never discarded/active ones", () => {
    const db = openTestDb(false);
    const { workout, profile } = setup(db, "2026-02-01T10:00:00.000Z");
    const a = workout.startEmptyWorkout(profile.id);
    workout.finishWorkout(a.id, { incompleteSetPolicy: "remove", finishedAtUtc: "2026-02-01T11:00:00.000Z" });
    const b = workout.startEmptyWorkout(profile.id, { startedAtUtc: "2026-02-03T10:00:00.000Z" });
    workout.finishWorkout(b.id, { incompleteSetPolicy: "remove", finishedAtUtc: "2026-02-03T11:00:00.000Z" });
    const c = workout.startEmptyWorkout(profile.id, { startedAtUtc: "2026-02-05T10:00:00.000Z" });
    workout.discardWorkout(c.id);
    const d = workout.startEmptyWorkout(profile.id, { startedAtUtc: "2026-02-06T10:00:00.000Z" });
    // Active workout d is not history either.
    const history = workout.listHistory(profile.id);
    expect(history.map((h) => h.workout.id)).toEqual([b.id, a.id]);
    void d;
  });

  it("previous performance returns the latest completed sets and excludes the current workout", () => {
    const db = openTestDb();
    const { workout, profile } = setup(db, "2026-02-01T10:00:00.000Z");
    const bench = db.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    // No history at all.
    expect(workout.getPreviousPerformance(profile.id, bench.id)).toBeNull();

    const w1 = workout.startEmptyWorkout(profile.id);
    const we1 = db.repos.workout.addExercise(w1.id, { exerciseId: bench.id });
    for (const [kg, reps] of [[100, 6], [100, 5], [95, 7]] as const) {
      const s = workout.addSet(we1.id, { setType: "normal", weightKg: kg, reps });
      workout.completeSet(s.id);
    }
    // Warmup set is completed too but must appear (it is part of history).
    const warm = workout.addSet(we1.id, { setType: "warmup", weightKg: 60, reps: 10 });
    workout.completeSet(warm.id);
    workout.finishWorkout(w1.id, { incompleteSetPolicy: "remove", finishedAtUtc: "2026-02-01T11:00:00.000Z" });

    // A later workout only logged an incomplete set for bench - not eligible.
    const w2 = workout.startEmptyWorkout(profile.id, { startedAtUtc: "2026-02-03T10:00:00.000Z" });
    const we2 = db.repos.workout.addExercise(w2.id, { exerciseId: bench.id });
    workout.addSet(we2.id, { setType: "normal", weightKg: 110, reps: 3 }); // not completed
    const prev = workout.getPreviousPerformance(profile.id, bench.id, w2.id);
    expect(prev?.workoutId).toBe(w1.id);
    // Sets in logged order: the warmup was logged last.
    expect(prev?.sets.map((s) => [s.weightKg, s.reps])).toEqual([[100, 6], [100, 5], [95, 7], [60, 10]]);
    workout.discardWorkout(w2.id);

    // An intermediate completed workout with only a warmup becomes "latest".
    const w3 = workout.startEmptyWorkout(profile.id, { startedAtUtc: "2026-02-04T10:00:00.000Z" });
    const we3 = db.repos.workout.addExercise(w3.id, { exerciseId: bench.id });
    const s3 = workout.addSet(we3.id, { setType: "warmup", weightKg: 40, reps: 12 });
    workout.completeSet(s3.id);
    workout.finishWorkout(w3.id, { incompleteSetPolicy: "remove", finishedAtUtc: "2026-02-04T10:30:00.000Z" });
    const prev3 = workout.getPreviousPerformance(profile.id, bench.id);
    expect(prev3?.workoutId).toBe(w3.id);
  });

  it("getRecentExercises returns distinct recently logged exercises, newest first", () => {
    const db = openTestDb();
    const { workout, profile } = setup(db, "2026-02-01T10:00:00.000Z");
    const bench = db.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const squat = db.repos.exercise.resolveAlias("Squat (Barbell)")!;
    const w = workout.startEmptyWorkout(profile.id);
    const weBench = db.repos.workout.addExercise(w.id, { exerciseId: bench.id });
    const weSquat = db.repos.workout.addExercise(w.id, { exerciseId: squat.id });
    void weBench;
    workout.addSet(weSquat.id, { setType: "normal", weightKg: 100, reps: 5 });
    const recent = workout.getRecentExercises(profile.id, 8);
    expect(recent.map((e) => e.id)).toEqual([squat.id, bench.id]);
  });
});

/** Helper: routine exercise id of the second exercise. */
function detailSquat(db: { repos: OpenDatabaseResult }, routineId: string): string | null {
  const detail = db.repos.routine.getById(routineId);
  return detail?.exercises[1]?.id ?? null;
}