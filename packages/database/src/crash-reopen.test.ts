/**
 * Crash-safety acceptance (spec section 20): force-close the database halfway
 * through a workout; on reopen every persisted set must still be there and
 * the workout must still be resumable. No Finish action involved.
 */

import { afterAll, describe, expect, it } from "vitest";
import { NodeSqliteDriver } from "./node-driver";
import { openDatabase } from "./index";
import { catalog, cleanupFileDb, openTestFileDb } from "./testing/helpers";

const fileDb = openTestFileDb();

afterAll(() => {
  try {
    fileDb.driver.close();
  } catch {
    /* already closed during the test */
  }
  cleanupFileDb(fileDb.dir);
});

describe("crash / reopen (workout autosave)", () => {
  it("keeps the active workout and all completed sets across a hard close", () => {
    const { driver, repos, path } = fileDb;
    const profile = repos.profile.ensureDefault();
    const workout = repos.workout.createActive({
      profileId: profile.id,
      startedAt: "2026-02-01T10:00:00.000Z",
      startLocalDate: "2026-02-01",
      startTimezoneOffsetMinutes: 0,
    });
    const squat = repos.exercise.resolveAlias("Squat (Barbell)")!;
    const bench = repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const weSquat = repos.workout.addExercise(workout.id, { exerciseId: squat.id });
    const weBench = repos.workout.addExercise(workout.id, { exerciseId: bench.id });

    // Several completed sets - each write is its own transaction.
    repos.workout.addSet(weSquat.id, { setType: "warmup", weightKg: 80, reps: 8 }, "2026-02-01T10:02:00.000Z");
    repos.workout.addSet(weSquat.id, { setType: "normal", weightKg: 140, reps: 5 }, "2026-02-01T10:05:00.000Z");
    repos.workout.addSet(weSquat.id, { setType: "normal", weightKg: 145, reps: 5 }, "2026-02-01T10:08:00.000Z");
    repos.workout.addSet(weBench.id, { setType: "normal", weightKg: 90, reps: 5 }, "2026-02-01T10:11:00.000Z");
    const dirtyBefore = repos.dirty.count();

    // Simulate the process dying: close the database mid-workout.
    driver.close();

    // "Relaunch the application": fresh driver + fresh repository context.
    const driver2 = new NodeSqliteDriver(path);
    const repos2 = openDatabase(driver2, { catalog });
    try {
      const resumed = repos2.workout.getActive(profile.id);
      expect(resumed).not.toBeNull();
      expect(resumed!.workout.id).toBe(workout.id);
      expect(resumed!.workout.status).toBe("active");

      const byExercise = new Map(resumed!.exercises.map((e) => [e.workoutExercise.exerciseId, e]));
      expect(byExercise.get(squat.id)!.sets).toHaveLength(3);
      expect(byExercise.get(bench.id)!.sets).toHaveLength(1);
      const allSets = resumed!.exercises.flatMap((e) => e.sets);
      expect(allSets.every((s) => s.completedAt !== null)).toBe(true);
      expect(allSets.map((s) => s.weightKg)).toEqual([80, 140, 145, 90]);

      // Dirty markers survived the restart too.
      expect(repos2.dirty.count()).toBe(dirtyBefore);

      // And the workout can continue where it left off.
      repos2.workout.addSet(weBench.id, { setType: "normal", weightKg: 92.5, reps: 5 }, "2026-02-01T10:14:00.000Z");
      expect(repos2.workout.getById(workout.id)!.exercises[1]!.sets).toHaveLength(2);
    } finally {
      driver2.close();
    }
  });
});
