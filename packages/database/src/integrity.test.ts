import { describe, expect, it } from "vitest";
import { deterministicRepos, openTestDb } from "./testing/helpers";

describe("database integrity", () => {
  it("enforces foreign keys (no orphan rows)", () => {
    const { driver, repos } = deterministicRepos();
    expect(() =>
      driver.run(
        "INSERT INTO bodyweight_entries (id, profile_id, measured_at, weight_kg, source, created_at) " +
          "VALUES ('x', 'missing-profile', '2026-01-01T00:00:00Z', 80, 'test', '2026-01-01T00:00:00Z')",
      ),
    ).toThrow(/FOREIGN KEY/);
    void repos;
  });

  it("cascades workout -> exercises -> sets", () => {
    const { driver, repos } = deterministicRepos();
    const profile = repos.profile.ensureDefault();
    const workout = repos.workout.createActive({
      profileId: profile.id,
      startedAt: "2026-02-01T10:00:00.000Z",
      startLocalDate: "2026-02-01",
      startTimezoneOffsetMinutes: 0,
    });
    const ex = repos.exercise.search({ query: "barbell bench press", limit: 1 })[0]!;
    const we = repos.workout.addExercise(workout.id, { exerciseId: ex.id });
    repos.workout.addSet(we.id, { setType: "normal", weightKg: 100, reps: 5 }, "2026-02-01T10:05:00.000Z");
    repos.workout.addSet(we.id, { setType: "normal", weightKg: 105, reps: 5 }, "2026-02-01T10:07:00.000Z");

    repos.workout.complete(workout.id, "2026-02-01T11:00:00.000Z");
    expect(
      Number(driver.get("SELECT COUNT(*) AS n FROM workout_sets WHERE workout_exercise_id = ?", [we.id])?.n),
    ).toBe(2);
    // Deleting the workout row cascades through exercises to sets (v1 has no
    // repository-level workout delete - data ownership features come later;
    // the cascade is the safety net for explicit deletes like GDPR wipes).
    driver.run("DELETE FROM workouts WHERE id = ?", [workout.id]);
    expect(Number(driver.get("SELECT COUNT(*) AS n FROM workout_exercises WHERE workout_id = ?", [workout.id])?.n)).toBe(0);
    expect(Number(driver.get("SELECT COUNT(*) AS n FROM workout_sets WHERE workout_exercise_id = ?", [we.id])?.n)).toBe(0);
    void ex;
  });

  it("cascades profile deletion to bodyweight, routines and workouts", () => {
    const { driver, repos } = deterministicRepos();
    const profile = repos.profile.ensureDefault();
    repos.bodyweight.add({
      profileId: profile.id,
      measuredAt: "2026-02-01T08:00:00.000Z",
      weightKg: 82.5,
      source: "test",
    });
    const routine = repos.routine.create({ profileId: profile.id, name: "Push" });
    repos.workout.createActive({
      profileId: profile.id,
      startedAt: "2026-02-01T10:00:00.000Z",
      startLocalDate: "2026-02-01",
      startTimezoneOffsetMinutes: 0,
    });
    driver.run("DELETE FROM profiles WHERE id = ?", [profile.id]);
    expect(driver.get("SELECT COUNT(*) AS n FROM bodyweight_entries")?.n).toBe(0);
    expect(driver.get("SELECT COUNT(*) AS n FROM routines")?.n).toBe(0);
    expect(driver.get("SELECT COUNT(*) AS n FROM workouts")?.n).toBe(0);
    void routine;
  });

  it("restricts exercise deletion while referenced (routine/workout history is protected)", () => {
    const { driver, repos } = deterministicRepos();
    const profile = repos.profile.ensureDefault();
    const ex = repos.exercise.search({ query: "squat", limit: 1 })[0]!;
    const routine = repos.routine.create({ profileId: profile.id, name: "Legs" });
    repos.routine.addExercise(routine.id, { exerciseId: ex.id });
    expect(() => driver.run("DELETE FROM exercises WHERE id = ?", [ex.id])).toThrow(/FOREIGN KEY/);
  });

  it("enforces unique constraints (slug, alias, active workout, dirty queue, imports)", () => {
    const { driver, repos } = deterministicRepos();
    // exercises.slug UNIQUE
    expect(() =>
      driver.run("INSERT INTO exercises (id, slug, name, category, tracking_type, is_custom, source, " +
        "ranking_eligibility, ranking_strategy, created_at, updated_at) " +
        "VALUES ('dup', 'barbell-curl', 'Dup', 'strength', 'weight_reps', 0, 'x', 'unsupported', 'none', 't', 't')"),
    ).toThrow(/UNIQUE/);

    // exercise_aliases.normalized_alias UNIQUE (one canonical owner).
    const owner = String(
      driver.get("SELECT exercise_id FROM exercise_aliases WHERE normalized_alias = 'barbell curl'")?.exercise_id,
    );
    expect(() =>
      driver.run(
        "INSERT INTO exercise_aliases (id, exercise_id, alias, normalized_alias, locale, source) " +
          "VALUES ('a1', ?, 'Whatever Curl', 'barbell curl', 'en', 'user')",
        [owner],
      ),
    ).toThrow(/UNIQUE/);

    // Only one active workout per profile (partial unique index).
    const profile = repos.profile.ensureDefault();
    const start = {
      profileId: profile.id,
      startedAt: "2026-02-01T10:00:00.000Z",
      startLocalDate: "2026-02-01",
      startTimezoneOffsetMinutes: 0,
    };
    repos.workout.createActive(start);
    expect(() => repos.workout.createActive(start)).toThrow(/could not start a workout/);

    // derived_dirty UNIQUE(entity_type, entity_id, reason) - idempotent marks
    // (prior steps already produced workout/workout-set markers).
    const dirtyBefore = repos.dirty.count();
    repos.dirty.mark(profile.id, "workout", "w1", "sets_changed");
    repos.dirty.mark(profile.id, "workout", "w1", "sets_changed");
    expect(repos.dirty.count() - dirtyBefore).toBe(1);

    // imports UNIQUE(source, fingerprint).
    driver.run("INSERT INTO imports (id, source, fingerprint, imported_at) VALUES ('i1', 'hevy-csv', 'fp1', 't')");
    expect(() =>
      driver.run("INSERT INTO imports (id, source, fingerprint, imported_at) VALUES ('i2', 'hevy-csv', 'fp1', 't')"),
    ).toThrow(/UNIQUE/);
  });

  it("enforces domain CHECK constraints", () => {
    const { driver, repos } = deterministicRepos();
    const profile = repos.profile.ensureDefault();
    const workout = repos.workout.createActive({
      profileId: profile.id,
      startedAt: "2026-02-01T10:00:00.000Z",
      startLocalDate: "2026-02-01",
      startTimezoneOffsetMinutes: 0,
    });
    const ex = repos.exercise.search({ query: "squat", limit: 1 })[0]!;
    const we = repos.workout.addExercise(workout.id, { exerciseId: ex.id });

    // Negative weight rejected.
    expect(() =>
      driver.run(
        "INSERT INTO workout_sets (id, workout_exercise_id, position, set_type, weight_kg, created_at, updated_at) " +
          "VALUES ('s1', ?, 0, 'normal', -5, 't', 't')",
        [we.id],
      ),
    ).toThrow(/CHECK/);

    // Unknown set type rejected.
    expect(() =>
      driver.run(
        "INSERT INTO workout_sets (id, workout_exercise_id, position, set_type, created_at, updated_at) " +
          "VALUES ('s2', ?, 0, 'junk', 't', 't')",
        [we.id],
      ),
    ).toThrow(/CHECK/);

    // Completed workouts must carry finished_at (partial CHECK).
    expect(() =>
      driver.run("UPDATE workouts SET status = 'completed' WHERE id = ?", [workout.id]),
    ).toThrow(/CHECK/);

    // Bodyweight must be positive.
    expect(() =>
      repos.bodyweight.add({ profileId: profile.id, measuredAt: "2026-02-01T08:00:00.000Z", weightKg: -1, source: "test" }),
    ).toThrow(/positive/);
  });

  it("keeps user custom exercises out of the dataset seed scope", () => {
    const { driver } = openTestDb();
    expect(driver.get("SELECT COUNT(*) AS n FROM exercises WHERE is_custom = 1")?.n).toBe(0);
    expect(driver.get("SELECT COUNT(*) AS n FROM exercises WHERE is_custom = 0")?.n).toBe(876);
  });
});