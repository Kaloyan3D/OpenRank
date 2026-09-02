/**
 * Phase 4 process-death acceptance (task U).
 *
 * Simulates the full gym scenario on a file-backed database:
 * create active workout -> multiple exercises -> several sets (some
 * completed, one incomplete with committed values) -> set types -> notes ->
 * rest timer -> hard close -> reopen fresh context -> resume.
 */

import { afterAll, describe, expect, it } from "vitest";
import { NodeSqliteDriver } from "../node-driver";
import { openDatabase } from "../index";
import { catalog, cleanupFileDb, openTestFileDb } from "../testing/helpers";
import { createServices } from "./index";

const file = openTestFileDb();

afterAll(() => {
  try {
    file.driver.close();
  } catch {
    /* closed inside the test */
  }
  cleanupFileDb(file.dir);
});

/** Clock advancing 1s per call from the given instant. */
function makeClock(startIso = "2026-02-01T10:00:00.000Z") {
  let ms = Date.parse(startIso);
  return () => {
    const iso = new Date(ms).toISOString();
    ms += 1000;
    return iso;
  };
}

describe("process death acceptance (full workout recovery)", () => {
  it("preserves structure, sets, types, notes, duration, dirty queue and rest timer", () => {
    const now = makeClock();
    const services = createServices(file.driver, file.repos, { now });
    const profile = file.repos.profile.ensureDefault();
    const squat = file.repos.exercise.resolveAlias("Squat (Barbell)")!;
    const bench = file.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const pull = file.repos.exercise.resolveAlias("Pull Up")!;

    // 1-2. active workout with three exercises in a defined order.
    const w = services.workout.startEmptyWorkout(profile.id, { title: "Recovery Test", timezoneOffsetMinutes: 60 });
    const weSquat = file.repos.workout.addExercise(w.id, { exerciseId: squat.id, restSeconds: 180 });
    const weBench = file.repos.workout.addExercise(w.id, { exerciseId: bench.id, restSeconds: 120, supersetGroup: "A" });
    const wePull = file.repos.workout.addExercise(w.id, { exerciseId: pull.id, restSeconds: 90, supersetGroup: "A" });

    // 3-4. completed sets of various types.
    const s1 = services.workout.addSet(weSquat.id, { setType: "warmup", weightKg: 80, reps: 8 });
    services.workout.completeSet(s1.id);
    const s2 = services.workout.addSet(weSquat.id, { setType: "normal", weightKg: 140, reps: 5 });
    services.workout.completeSet(s2.id);
    const s3 = services.workout.addSet(weBench.id, { setType: "amrap", weightKg: 90, reps: 8, rpe: 9 });
    services.workout.completeSet(s3.id);
    const s4 = services.workout.addSet(wePull.id, { setType: "failure", weightKg: null, reps: 7, rir: 1 });
    services.workout.completeSet(s4.id);
    // 5. one incomplete set with committed values (weight entered, not done).
    services.workout.addSet(weSquat.id, { setType: "normal", weightKg: 145, reps: 3 });

    // 6. notes at both levels + a running rest timer.
    services.workout.updateExerciseNotes(weBench.id, "pause 1s at chest");
    services.workout.updateWorkoutNotes(w.id, "felt strong");
    services.restTimer.start(profile.id, w.id, 120, weBench.id);
    const timerBefore = services.restTimer.getActive(profile.id)!;
    expect(timerBefore.remainingSeconds).toBeGreaterThan(100);
    const dirtyBefore = file.repos.dirty.count();
    const startedAt = file.repos.workout.getById(w.id)!.workout.startedAt;

    // 7. process death.
    file.driver.close();

    // 8. fresh context (clock keeps advancing as if time passed).
    const driver2 = new NodeSqliteDriver(file.path);
    // The "new session" starts 25 minutes later (the app was closed).
    const clock2 = makeClock("2026-02-01T10:25:00.000Z");
    try {
      const repos2 = openDatabase(driver2, { catalog });
      const services2 = createServices(driver2, repos2, { now: clock2 });

      // 9. resume: active status preserved, structure identical.
      const resumed = services2.workout.resumeActiveWorkout(profile.id);
      expect(resumed).not.toBeNull();
      expect(resumed!.workout.id).toBe(w.id);
      expect(resumed!.workout.status).toBe("active");
      expect(resumed!.workout.title).toBe("Recovery Test");
      expect(resumed!.workout.startedAt).toBe(startedAt);
      expect(resumed!.workout.logicalTrainingDate).toBe(resumed!.workout.startLocalDate);
      expect(resumed!.workout.startTimezoneOffsetMinutes).toBe(60);

      // Exercise order preserved (squat, bench, pull).
      expect(resumed!.exercises.map((e) => e.workoutExercise.exerciseId)).toEqual([
        squat.id, bench.id, pull.id,
      ]);
      expect(resumed!.exercises.map((e) => e.workoutExercise.restSeconds)).toEqual([180, 120, 90]);
      expect(resumed!.exercises.map((e) => e.workoutExercise.supersetGroup)).toEqual([null, "A", "A"]);

      // Sets: positions, types, values, completion states.
      const squatSets = resumed!.exercises[0]!.sets;
      expect(squatSets.map((s) => [s.setType, s.weightKg, s.reps, s.completedAt != null])).toEqual([
        ["warmup", 80, 8, true],
        ["normal", 140, 5, true],
        ["normal", 145, 3, false], // incomplete but committed values preserved
      ]);
      const benchSets = resumed!.exercises[1]!.sets;
      expect(benchSets).toHaveLength(1);
      expect(benchSets[0]!.setType).toBe("amrap");
      expect(benchSets[0]!.rpe).toBe(9);
      const pullSets = resumed!.exercises[2]!.sets;
      expect(pullSets[0]!.setType).toBe("failure");
      expect(pullSets[0]!.rir).toBe(1);
      expect(pullSets[0]!.weightKg).toBeNull(); // bodyweight: no external load stored

      // Notes preserved (exercise + workout).
      expect(resumed!.exercises[1]!.workoutExercise.notes).toBe("pause 1s at chest");
      expect(resumed!.workout.notes).toBe("felt strong");

      // Dirty markers preserved.
      expect(repos2.dirty.count()).toBe(dirtyBefore);

      // Workout duration continues correctly (derived from started_at).
      const summary = services2.workout.getSummary(w.id);
      expect(summary.completedSetCount).toBe(4);
      // Duration continues from started_at (>= 25 minutes after reopen).
      expect(summary.durationSeconds).toBeGreaterThanOrEqual(25 * 60 - 5);

      // Rest timer derives correct state after restart: the 120 s rest ran
      // out while the app was "dead" (25 min), so it reports expired and the
      // UI shows completed/clear - exactly the timestamp-derived semantics.
      const timer = services2.restTimer.getActive(profile.id)!;
      expect(timer.workoutId).toBe(w.id);
      expect(timer.endsAt).toBe(timerBefore.endsAt);
      expect(timer.expired).toBe(true);
      expect(timer.remainingSeconds).toBe(0);
      // A rest period that is still running resumes with correct remaining.
      services2.restTimer.start(profile.id, w.id, 120);
      const live = services2.restTimer.getActive(profile.id)!;
      expect(live.expired).toBe(false);
      expect(live.remainingSeconds).toBeGreaterThan(100);

      // And the workout continues: log + complete another set.
      const s5 = services2.workout.addSet(weSquat.id, { setType: "normal", weightKg: 145, reps: 5 });
      services2.workout.completeSet(s5.id);
      expect(services2.workout.getSummary(w.id).completedSetCount).toBe(5);

      // Finish flow still works after recovery.
      const final = services2.workout.finishWorkout(w.id, { incompleteSetPolicy: "remove" });
      expect(final.workout.status).toBe("completed");
      expect(final.completedSetCount).toBe(5);
      expect(services2.restTimer.getActive(profile.id)).toBeNull();
    } finally {
      driver2.close();
    }
  });
});