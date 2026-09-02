import { describe, expect, it } from "vitest";
import { deterministicRepos } from "./testing/helpers";

function startInput(profileId: string) {
  return {
    profileId,
    startedAt: "2026-02-01T10:00:00.000Z",
    startLocalDate: "2026-02-01",
    startTimezoneOffsetMinutes: 60,
  };
}

describe("WorkoutRepository", () => {
  it("creates an active workout with local date, logical date and offset", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const w = repos.workout.createActive(startInput(p.id));
    expect(w.status).toBe("active");
    expect(w.startLocalDate).toBe("2026-02-01");
    expect(w.logicalTrainingDate).toBe("2026-02-01");
    expect(w.startTimezoneOffsetMinutes).toBe(60);
    expect(w.finishedAt).toBeNull();
  });

  it("enforces a single active workout per profile (resume semantics)", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const first = repos.workout.createActive(startInput(p.id));
    expect(() => repos.workout.createActive(startInput(p.id))).toThrow(/could not start a workout/);
    const resumed = repos.workout.getActive(p.id);
    expect(resumed?.workout.id).toBe(first.id);
  });

  it("adds exercises and sets, completes, updates and deletes sets (autosave-safe)", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const w = repos.workout.createActive(startInput(p.id));
    const bench = repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const we = repos.workout.addExercise(w.id, { exerciseId: bench.id, restSeconds: 150, supersetGroup: null });

    const s1 = repos.workout.addSet(we.id, { setType: "warmup", weightKg: 60, reps: 8 });
    const s2 = repos.workout.addSet(we.id, { setType: "normal", weightKg: 80, reps: 5 }, "2026-02-01T10:05:00.000Z");
    expect(s1.position).toBe(0);
    expect(s2.position).toBe(1);
    expect(s2.completedAt).toBe("2026-02-01T10:05:00.000Z");
    expect(s1.completedAt).toBeNull();

    repos.workout.completeSet(s1.id, "2026-02-01T10:04:00.000Z");
    const updated = repos.workout.updateSet(s2.id, { weightKg: 82.5, reps: 4 });
    expect(updated.weightKg).toBeCloseTo(82.5);
    expect(updated.reps).toBe(4);

    const s3 = repos.workout.addSet(we.id, { setType: "drop", weightKg: 70, reps: 8 });
    repos.workout.deleteSet(s3.id);
    const detail = repos.workout.getById(w.id)!;
    expect(detail.exercises[0]!.sets.map((s) => s.position)).toEqual([0, 1]);
    expect(detail.exercises[0]!.sets.every((s) => s.completedAt !== null)).toBe(true);
  });

  it("reorders workout exercises", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const w = repos.workout.createActive(startInput(p.id));
    const a = repos.workout.addExercise(w.id, { exerciseId: repos.exercise.resolveAlias("Squat (Barbell)")!.id });
    const b = repos.workout.addExercise(w.id, { exerciseId: repos.exercise.resolveAlias("Bench Press (Barbell)")!.id });
    repos.workout.reorderExercises(w.id, [b.id, a.id]);
    const detail = repos.workout.getById(w.id)!;
    expect(detail.exercises.map((e) => e.workoutExercise.id)).toEqual([b.id, a.id]);
    expect(detail.exercises.map((e) => e.workoutExercise.position)).toEqual([0, 1]);
  });

  it("completes and discards workouts and lists history newest-first", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const w1 = repos.workout.createActive(startInput(p.id));
    repos.workout.complete(w1.id, "2026-02-01T11:00:00.000Z");
    const done = repos.workout.getById(w1.id)!.workout;
    expect(done.status).toBe("completed");
    expect(done.finishedAt).toBe("2026-02-01T11:00:00.000Z");
    // No active workout remains.
    expect(repos.workout.getActive(p.id)).toBeNull();

    const w2 = repos.workout.createActive({ ...startInput(p.id), startedAt: "2026-02-03T10:00:00.000Z", startLocalDate: "2026-02-03" });
    repos.workout.discard(w2.id, "2026-02-03T10:10:00.000Z");
    expect(repos.workout.getById(w2.id)!.workout.status).toBe("discarded");

    const w3 = repos.workout.createActive({ ...startInput(p.id), startedAt: "2026-02-05T10:00:00.000Z", startLocalDate: "2026-02-05" });
    repos.workout.complete(w3.id, "2026-02-05T11:00:00.000Z");

    const history = repos.workout.listHistory(p.id);
    expect(history.map((d) => d.workout.startedAt)).toEqual([
      "2026-02-05T10:00:00.000Z",
      "2026-02-01T10:00:00.000Z",
    ]);
    // Discarded workouts are not history.
    expect(history.some((d) => d.workout.id === w2.id)).toBe(false);
  });

  it("marks derived state dirty for every canonical change", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const w = repos.workout.createActive(startInput(p.id));
    const we = repos.workout.addExercise(w.id, { exerciseId: repos.exercise.resolveAlias("Squat (Barbell)")!.id });
    repos.workout.addSet(we.id, { setType: "normal", weightKg: 100, reps: 5 });
    repos.workout.completeSet(
      repos.workout.getById(w.id)!.exercises[0]!.sets[0]!.id,
      "2026-02-01T10:05:00.000Z",
    );
    repos.workout.complete(w.id, "2026-02-01T11:00:00.000Z");

    const reasons = repos.dirty.list().filter((m) => m.entityType === "workout").map((m) => m.reason);
    expect(reasons).toContain("sets_changed");
    expect(reasons).toContain("workout_completed");
    // Dirty markers persist (same transaction as the canonical write).
    expect(repos.dirty.count()).toBeGreaterThan(0);
  });
});
