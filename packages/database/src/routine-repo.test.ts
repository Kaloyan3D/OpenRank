import { describe, expect, it } from "vitest";
import { deterministicRepos, openTestDb } from "./testing/helpers";

describe("RoutineRepository", () => {
  it("creates, renames, notes, archives and unarchives routines", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const routine = repos.routine.create({ profileId: p.id, name: "Push Day", notes: "bench focus" });
    expect(routine.name).toBe("Push Day");
    expect(routine.archivedAt).toBeNull();

    repos.routine.rename(routine.id, "Push Day A");
    repos.routine.setNotes(routine.id, null);
    repos.routine.archive(routine.id, "2026-02-02T00:00:00.000Z");
    const archived = repos.routine.getById(routine.id)!.routine;
    expect(archived.name).toBe("Push Day A");
    expect(archived.archivedAt).toBe("2026-02-02T00:00:00.000Z");
    expect(repos.routine.list(p.id)).toHaveLength(0);
    expect(repos.routine.list(p.id, true)).toHaveLength(1);
    repos.routine.unarchive(routine.id);
    expect(repos.routine.list(p.id)).toHaveLength(1);
  });

  it("adds, reorders, configures and removes exercises with dense positions", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const routine = repos.routine.create({ profileId: p.id, name: "Legs" });
    const squat = repos.exercise.resolveAlias("Squat (Barbell)")!;
    const legPress = repos.exercise.search({ query: "leg press", limit: 1 })[0]!;
    const legCurl = repos.exercise.findBySlug("seated-leg-curl")!;

    const a = repos.routine.addExercise(routine.id, { exerciseId: squat.id, restSeconds: 180 });
    const b = repos.routine.addExercise(routine.id, { exerciseId: legPress.id });
    const c = repos.routine.addExercise(routine.id, { exerciseId: legCurl.id, supersetGroup: "ss1" });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);

    repos.routine.setRestSeconds(a.id, 240);
    repos.routine.setSupersetGroup(c.id, null);
    expect(repos.routine.getById(routine.id)!.exercises[0]!.restSeconds).toBe(240);

    repos.routine.reorderExercises(routine.id, [c.id, a.id, b.id]);
    const ordered = repos.routine.getById(routine.id)!.exercises.map((e) => e.id);
    expect(ordered).toEqual([c.id, a.id, b.id]);
    expect(repos.routine.getById(routine.id)!.exercises.map((e) => e.position)).toEqual([0, 1, 2]);

    repos.routine.removeExercise(a.id);
    const after = repos.routine.getById(routine.id)!.exercises;
    expect(after.map((e) => e.id)).toEqual([c.id, b.id]);
    expect(after.map((e) => e.position)).toEqual([0, 1]);
  });

  it("rejects reordering with foreign exercise ids", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const r1 = repos.routine.create({ profileId: p.id, name: "A" });
    const r2 = repos.routine.create({ profileId: p.id, name: "B" });
    const ex = repos.exercise.resolveAlias("Squat (Barbell)")!;
    const other = repos.routine.addExercise(r2.id, { exerciseId: ex.id });
    expect(() => repos.routine.reorderExercises(r1.id, [other.id])).toThrow(/does not belong/);
  });

  it("replaces target sets transactionally", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const routine = repos.routine.create({ profileId: p.id, name: "Push" });
    const bench = repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const re = repos.routine.addExercise(routine.id, { exerciseId: bench.id });

    const targets = repos.routine.setTargets(re.id, [
      { setType: "warmup", targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: 60 },
      { setType: "normal", targetRepsMin: 5, targetRepsMax: 8, targetWeightKg: 80, targetRpe: 8 },
      { setType: "amrap", targetRepsMin: 5, targetWeightKg: 80 },
    ]);
    expect(targets.map((t) => t.position)).toEqual([0, 1, 2]);
    expect(targets[1]!.targetRpe).toBe(8);

    // Replace: old targets are gone.
    const replaced = repos.routine.setTargets(re.id, [{ setType: "failure", targetRepsMin: 3 }]);
    expect(replaced).toHaveLength(1);
    expect(repos.routine.getById(routine.id)!.exercises[0]!.targets).toHaveLength(1);
    expect(repos.routine.getById(routine.id)!.exercises[0]!.targets[0]!.setType).toBe("failure");
  });

  it("deletes routines and cascades to exercises + targets", () => {
    const { driver, repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const routine = repos.routine.create({ profileId: p.id, name: "Temp" });
    const ex = repos.exercise.resolveAlias("Squat (Barbell)")!;
    const re = repos.routine.addExercise(routine.id, { exerciseId: ex.id });
    repos.routine.setTargets(re.id, [{ setType: "normal", targetRepsMin: 8 }]);
    repos.routine.delete(routine.id);
    expect(Number(driver.get("SELECT COUNT(*) AS n FROM routine_exercises")?.n)).toBe(0);
    expect(Number(driver.get("SELECT COUNT(*) AS n FROM routine_set_targets")?.n)).toBe(0);
    void openTestDb;
  });
});