import { describe, expect, it } from "vitest";
import type { TrackingType } from "@openrank/domain";
import { openTestDb } from "../testing/helpers";
import { createServices } from "./index";
import { SetValidationError } from "./set-validation";

describe("RoutineService (builder)", () => {
  it("creates, renames, archives, unarchives and separates lists", () => {
    const db = openTestDb();
    const { routine, workout } = createServices(db.driver, db.repos);
    const profile = db.repos.profile.ensureDefault();
    const r = routine.create(profile.id, "Pull Day");
    routine.rename(r.id, "Pull Day A");
    routine.setNotes(r.id, "rows and pulldowns");
    expect(routine.list(profile.id).active.map((x) => x.name)).toEqual(["Pull Day A"]);
    routine.archive(r.id);
    expect(routine.list(profile.id).active).toHaveLength(0);
    expect(routine.list(profile.id).archived).toHaveLength(1);
    // Archived routines remain available historically (getById works).
    expect(routine.get(r.id).routine.name).toBe("Pull Day A");
    routine.unarchive(r.id);
    expect(routine.list(profile.id).active).toHaveLength(1);
    void workout;
  });

  it("rejects empty names and unknown exercises", () => {
    const db = openTestDb();
    const { routine } = createServices(db.driver, db.repos);
    const profile = db.repos.profile.ensureDefault();
    const r = routine.create(profile.id, "X");
    expect(() => routine.create(profile.id, "   ")).toThrow(/empty/);
    expect(() => routine.rename(r.id, "")).toThrow(/empty/);
    expect(() => routine.addExercise(r.id, { exerciseId: "fdb:does-not-exist" })).toThrow(/not found/);
  });

  it("configures rest, superset groups, reorders and replaces targets", () => {
    const db = openTestDb();
    const { routine } = createServices(db.driver, db.repos);
    const profile = db.repos.profile.ensureDefault();
    const squat = db.repos.exercise.resolveAlias("Squat (Barbell)")!;
    const bench = db.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const r = routine.create(profile.id, "Full Body");
    routine.addExercise(r.id, { exerciseId: squat.id, restSeconds: 180 });
    routine.addExercise(r.id, { exerciseId: bench.id });
    const detail = routine.get(r.id);
    const [s, b] = detail.exercises;
    routine.setSupersetGroup(s!.id, "A");
    routine.setSupersetGroup(b!.id, "A");
    routine.setRestSeconds(b!.id, 90);
    routine.setTargets(b!.id, [
      { setType: "warmup", targetRepsMin: 8, targetRepsMax: 10 },
      { setType: "normal", targetRepsMin: 5, targetRepsMax: 6, targetWeightKg: 80, targetRpe: 8 },
    ]);
    const after = routine.get(r.id);
    expect(after.exercises.map((e) => e.supersetGroup)).toEqual(["A", "A"]);
    expect(after.exercises[1]!.restSeconds).toBe(90);
    expect(after.exercises[1]!.targets).toHaveLength(2);
    expect(after.exercises[1]!.targets[1]!.targetRpe).toBe(8);

    routine.reorderExercises(r.id, [b!.id, s!.id]);
    expect(routine.get(r.id).exercises.map((e) => e.exerciseId)).toEqual([bench.id, squat.id]);
  });

  it("rejects invalid rest seconds", () => {
    const db = openTestDb();
    const { routine } = createServices(db.driver, db.repos);
    const profile = db.repos.profile.ensureDefault();
    const squat = db.repos.exercise.resolveAlias("Squat (Barbell)")!;
    const r = routine.create(profile.id, "Legs");
    routine.addExercise(r.id, { exerciseId: squat.id });
    const re = routine.get(r.id).exercises[0]!;
    expect(() => routine.setRestSeconds(re.id, -5)).toThrow(/positive/);
    expect(() => routine.setRestSeconds(re.id, Number.NaN)).toThrow(/positive/);
    expect(() => routine.setRestSeconds(re.id, null)).not.toThrow();
  });
});

interface Case {
  name: string;
  trackingType: TrackingType;
  valid: Record<string, unknown>;
  invalid: Record<string, unknown>;
}

describe("WorkoutService - set operations over all tracking types", () => {
  it("adds, edits, completes and deletes sets with validation per tracking type", () => {
    const db = openTestDb();
    const { workout } = createServices(db.driver, db.repos);
    const profile = db.repos.profile.ensureDefault();
    const w = workout.startEmptyWorkout(profile.id);

    const cases: Case[] = [
      { name: "Barbell Squat Copy", trackingType: "weight_reps", valid: { weightKg: 140, reps: 5 }, invalid: { weightKg: 140 } },
      { name: "BW Reps Custom", trackingType: "bodyweight_reps", valid: { reps: 10 }, invalid: {} },
      { name: "BW Weighted Custom", trackingType: "bodyweight_weighted", valid: { weightKg: 20, reps: 5 }, invalid: { reps: 5 } },
      { name: "BW Assisted Custom", trackingType: "bodyweight_assisted", valid: { weightKg: 25, reps: 6 }, invalid: { weightKg: 25 } },
      { name: "Reps Only Custom", trackingType: "reps_only", valid: { reps: 15 }, invalid: {} },
      { name: "Duration Custom", trackingType: "duration", valid: { durationSeconds: 600 }, invalid: { reps: 10 } },
      { name: "Distance Custom", trackingType: "distance_duration", valid: { distanceMeters: 5000, durationSeconds: 1500 }, invalid: { distanceMeters: 5000 } },
    ];

    for (const c of cases) {
      const ex = db.repos.exercise.createCustom({
        name: c.name,
        category: "strength",
        mechanic: "compound",
        force: "push",
        equipment: null,
        trackingType: c.trackingType,
      });
      const we = db.repos.workout.addExercise(w.id, { exerciseId: ex.id });
      // Invalid completion (missing required fields) is rejected at add-time completion AND at completeSet.
      const bad = workout.addSet(we.id, { setType: "normal", ...c.invalid } as never);
      expect(() => workout.completeSet(bad.id)).toThrow(SetValidationError);
      // Valid completion persists + completes atomically.
      const good = workout.addSet(we.id, { setType: "normal", ...c.valid } as never);
      const result = workout.completeSet(good.id);
      expect(result.set.completedAt).not.toBeNull();
      // Editing a completed set keeps values canonical.
      if (c.valid.weightKg != null) {
        const updated = workout.updateSet(good.id, { weightKg: (c.valid.weightKg as number) + 2.5 });
        expect(updated.weightKg).toBeCloseTo((c.valid.weightKg as number) + 2.5);
      }
      workout.deleteSet(bad.id);
      const after = db.repos.workout.getById(w.id)!.exercises.find((e) => e.workoutExercise.id === we.id)!;
      expect(after.sets).toHaveLength(1);
      expect(after.sets[0]!.completedAt).not.toBeNull();
    }
  });

  it("uncompletes a set but keeps its values", () => {
    const db = openTestDb();
    const { workout } = createServices(db.driver, db.repos);
    const profile = db.repos.profile.ensureDefault();
    const w = workout.startEmptyWorkout(profile.id);
    const bench = db.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const we = db.repos.workout.addExercise(w.id, { exerciseId: bench.id });
    const s = workout.addSet(we.id, { setType: "normal", weightKg: 80, reps: 8 });
    workout.completeSet(s.id);
    const un = workout.uncompleteSet(s.id);
    expect(un.completedAt).toBeNull();
    expect(un.weightKg).toBeCloseTo(80);
    expect(un.reps).toBe(8);
  });

  it("emits dirty markers for completed, changed-completed and deleted completed sets", () => {
    const db = openTestDb();
    const { workout } = createServices(db.driver, db.repos);
    const profile = db.repos.profile.ensureDefault();
    const bench = db.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const w = workout.startEmptyWorkout(profile.id);
    const we = db.repos.workout.addExercise(w.id, { exerciseId: bench.id });
    const s1 = workout.addSet(we.id, { setType: "normal", weightKg: 80, reps: 8 });
    workout.completeSet(s1.id);
    expect(db.repos.dirty.count()).toBeGreaterThan(0);
    workout.updateSet(s1.id, { reps: 9 }); // changed completed set
    const withSet = db.repos.dirty.list().filter((m) => m.entityType === "workout_set");
    expect(withSet.map((m) => m.entityId)).toContain(s1.id);
    workout.deleteSet(s1.id); // deleted completed set
    // deleteSet intentionally emits a final tombstone marker for the deleted
    // set so Phase 5 can rebuild; discardWorkout removes markers entirely.
    const tombstone = db.repos.dirty.list().filter((m) => m.entityType === "workout_set" && m.entityId === s1.id);
    expect(tombstone).toHaveLength(1);
  });

  it("starts the rest timer automatically after completing a set with rest_seconds > 0", () => {
    const db = openTestDb();
    const now = (() => {
      let ms = Date.parse("2026-02-01T10:00:00.000Z");
      return () => {
        const iso = new Date(ms).toISOString();
        ms += 1000;
        return iso;
      };
    })();
    const { workout, restTimer } = createServices(db.driver, db.repos, { now });
    const profile = db.repos.profile.ensureDefault();
    const bench = db.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const w = workout.startEmptyWorkout(profile.id);
    const withRest = db.repos.workout.addExercise(w.id, { exerciseId: bench.id, restSeconds: 120 });
    const s1 = workout.addSet(withRest.id, { setType: "normal", weightKg: 80, reps: 8 });
    const result = workout.completeSet(s1.id);
    expect(result.rest).not.toBeNull();
    expect(result.rest?.durationSeconds).toBe(120);
    expect(restTimer.getActive(profile.id)?.workoutId).toBe(w.id);

    const noRest = db.repos.workout.addExercise(w.id, { exerciseId: bench.id, restSeconds: null });
    const s2 = workout.addSet(noRest.id, { setType: "normal", weightKg: 80, reps: 8 });
    const result2 = workout.completeSet(s2.id);
    expect(result2.rest).toBeNull();
  });
});