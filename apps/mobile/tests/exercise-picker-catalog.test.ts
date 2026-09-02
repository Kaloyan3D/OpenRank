/**
 * Phase 8.2 P0.1 - exercise-picker catalog filter correctness (permanent
 * regression tests, requirements A-M).
 *
 * Locks:
 * - three-valued equipment semantics (undefined = no filter / All; null =
 *   no-equipment rows only; string = one canonical equipment tag);
 * - default picker state = undefined (never null), so the whole catalog is
 *   browsable and weighted exercises are discoverable;
 * - honest null-equipment display ("No equipment", never "bodyweight");
 * - no silent 60-row cap: "All" returns the full matching catalog and the
 *   count is the honest result-set size;
 * - unsupported-rank exercises stay selectable/loggable;
 * - the workout picker and the routine picker are one screen with one
 *   search-options path.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogV1 } from "@openrank/exercise-catalog";
import { createServices, openDatabase } from "@openrank/database";
import type { OpenDatabaseResult, OpenRankServices } from "@openrank/database";
import { NodeSqliteDriver } from "@openrank/database/node";
import {
  EQUIPMENT_FILTERS,
  equipmentLabel,
  exercisePickerSearchOptions,
  toggleEquipmentFilter,
} from "../src/ui/equipment";

/** Read a repo-root-relative source file (same convention as the other tests). */
function src(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", "..", "..", ...segments), "utf8");
}
const MOBILE = ["apps", "mobile", "src"];

const catalog = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "packages", "exercise-catalog", "data", "catalog.v1.json"), "utf8"),
) as CatalogV1;

interface TestDb {
  driver: NodeSqliteDriver;
  repos: OpenDatabaseResult;
  services: OpenRankServices;
}

/** Fresh in-memory database migrated + seeded with the committed catalog. */
function openSeeded(): TestDb {
  const driver = new NodeSqliteDriver(":memory:");
  const repos = openDatabase(driver, { catalog });
  const services = createServices(driver, repos);
  return { driver, repos, services };
}

const pickerSource = (): string => src(...MOBILE, "app", "exercise-picker.tsx");
const compact = (s: string): string => s.replace(/\s+/g, " ");

// ------------------------------------------------ A: filter semantics --

describe("picker equipment filter semantics (A, F, G)", () => {
  it("A: default picker options omit the equipment filter (undefined, never null)", () => {
    const options = exercisePickerSearchOptions({
      query: "",
      group: null,
      tracking: null,
      equipment: undefined,
    });
    expect(options.equipment).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(options, "equipment")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(options, "limit")).toBe(false);
    expect(options).toEqual({ query: "", majorGroup: null, trackingType: null });
  });

  it("A: the picker screen starts in undefined state and All resets to undefined", () => {
    const source = pickerSource();
    expect(source).toContain("useState<EquipmentFilterState>(undefined)");
    expect(source).toContain("equipment === undefined");
    expect(source).toContain("setEquipment(undefined)");
  });

  it("A: chosen equipment filters pass through verbatim, including null", () => {
    const base = { query: "", group: null, tracking: null } as const;
    expect(exercisePickerSearchOptions({ ...base, equipment: null })).toEqual({
      query: "",
      majorGroup: null,
      trackingType: null,
      equipment: null,
    });
    expect(
      exercisePickerSearchOptions({
        query: "curl",
        group: "arms",
        tracking: "weight_reps",
        equipment: "barbell",
      }),
    ).toEqual({ query: "curl", majorGroup: "arms", trackingType: "weight_reps", equipment: "barbell" });
  });

  it("A: chip toggling clears to undefined (All) and never leaves null behind", () => {
    expect(toggleEquipmentFilter(undefined, "dumbbell")).toBe("dumbbell");
    expect(toggleEquipmentFilter("dumbbell", "dumbbell")).toBeUndefined();
    // The exposed "No equipment" chip selects null explicitly ...
    expect(toggleEquipmentFilter(undefined, null)).toBeNull();
    // ... and toggling it off returns to All (undefined), never a stuck filter.
    expect(toggleEquipmentFilter(null, null)).toBeUndefined();
  });

  it("exposes every catalog equipment category as a deliberate filter (nothing silently hidden)", () => {
    const distinct = new Set<string | null>(catalog.exercises.map((e) => e.equipment));
    // All 13 canonical categories are covered - barbell, dumbbell, machine,
    // cable, kettlebell, bodyweight, bands plus no-equipment (null),
    // ez-curl-bar, exercise-ball, medicine-ball, foam-roll and other.
    expect(EQUIPMENT_FILTERS.length).toBeGreaterThanOrEqual(13);
    for (const value of distinct) {
      expect(
        EQUIPMENT_FILTERS.some((option) => option.value === value),
        "missing equipment filter for " + JSON.stringify(value),
      ).toBe(true);
    }
    // The null option is labelled honestly.
    expect(EQUIPMENT_FILTERS.find((option) => option.value === null)?.label).toBe("No equipment");
    // No duplicate canonical values.
    expect(new Set(EQUIPMENT_FILTERS.map((option) => option.value)).size).toBe(EQUIPMENT_FILTERS.length);
  });

  it("F: null equipment displays as No equipment, never bodyweight", () => {
    expect(equipmentLabel(null)).toBe("No equipment");
    expect(equipmentLabel(null)).not.toContain("bodyweight");
    // Unknown/missing metadata is never inferred to be bodyweight either.
    expect(equipmentLabel(undefined)).toBe("No equipment");
  });

  it("G: actual bodyweight equipment displays as bodyweight", () => {
    expect(equipmentLabel("bodyweight")).toBe("bodyweight");
    expect(equipmentLabel("barbell")).toBe("barbell");
  });
});

// ---------------------- B/C/D/E: repository + catalog filter semantics --

describe("default catalog search over the seeded repository (B, C, D, E, M)", () => {
  it("B: default repository search returns exercises across many equipment types", () => {
    const { repos } = openSeeded();
    const all = repos.exercise.search({});
    const equipmentSeen = new Set<string | null>(all.map((e) => e.equipment));
    for (const tag of ["barbell", "dumbbell", "machine", "cable", "kettlebell", "bodyweight", "bands"]) {
      expect(equipmentSeen.has(tag), "missing " + tag + " in default search").toBe(true);
    }
    expect(equipmentSeen.has(null), "missing no-equipment rows in default search").toBe(true);
  });

  it("C: All includes barbell, dumbbell, bodyweight, machine and cable examples", () => {
    const { repos } = openSeeded();
    const all = repos.exercise.search({});
    expect(all.some((e) => e.equipment === "barbell" && e.name.toLowerCase().includes("bench press"))).toBe(true);
    expect(all.some((e) => e.equipment === "dumbbell" && e.name.toLowerCase().includes("bench press"))).toBe(true);
    expect(all.some((e) => e.equipment === "bodyweight" && e.name.toLowerCase().includes("squat"))).toBe(true);
    expect(all.some((e) => e.equipment === "machine")).toBe(true);
    expect(all.some((e) => e.equipment === "cable")).toBe(true);
  });

  it("M: All is the complete catalog - never silently truncated to 60", () => {
    const { repos } = openSeeded();
    const all = repos.exercise.search({});
    expect(all.length).toBe(catalog.exercises.length);
    expect(all.length).toBeGreaterThan(60);
    // The picker's own "All" options (no equipment key) see the same rows.
    const pickerAll = repos.exercise.search(
      exercisePickerSearchOptions({ query: "", group: null, tracking: null, equipment: undefined }),
    );
    expect(pickerAll.map((e) => e.id)).toEqual(all.map((e) => e.id));
  });

  it("M: the picker passes no row cap into the repository", () => {
    expect(
      exercisePickerSearchOptions({ query: "", group: null, tracking: null, equipment: undefined }),
    ).not.toHaveProperty("limit");
    expect(pickerSource()).not.toContain("limit:");
  });

  it("D: equipment = null still intentionally means only no-equipment records", () => {
    const { repos } = openSeeded();
    const none = repos.exercise.search({ equipment: null });
    expect(none.length).toBeGreaterThan(0);
    expect(none.length).toBe(catalog.exercises.filter((e) => e.equipment == null).length);
    for (const exercise of none) expect(exercise.equipment).toBeNull();
    // Bodyweight rows are NOT no-equipment rows.
    expect(none.some((e) => e.equipment === "bodyweight")).toBe(false);
  });

  it("E: equipment = bodyweight returns only actual bodyweight rows", () => {
    const { repos } = openSeeded();
    const bw = repos.exercise.search({ equipment: "bodyweight" });
    expect(bw.length).toBeGreaterThan(0);
    expect(bw.length).toBe(catalog.exercises.filter((e) => e.equipment === "bodyweight").length);
    for (const exercise of bw) expect(exercise.equipment).toBe("bodyweight");
  });
});

// ------------------------- H/I/J/K: discoverability + availability --

describe("weighted exercises are discoverable and loggable (H, I, J, K)", () => {
  it("H: Bench Press is discoverable from the default picker search", () => {
    const { repos } = openSeeded();
    const results = repos.exercise.search({ query: "Bench Press" });
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.some((e) => e.equipment === "barbell" && e.name.toLowerCase().includes("bench press")),
    ).toBe(true);
  });

  it("I: Barbell Curl is discoverable", () => {
    const { repos } = openSeeded();
    const results = repos.exercise.search({ query: "Barbell Curl" });
    expect(
      results.some((e) => e.equipment === "barbell" && e.name.toLowerCase().includes("barbell curl")),
    ).toBe(true);
  });

  it("J: Squat and Deadlift are discoverable", () => {
    const { repos } = openSeeded();
    const squat = repos.exercise.search({ query: "Squat" });
    expect(squat.some((e) => e.equipment === "barbell" && e.name.toLowerCase().includes("squat"))).toBe(true);
    const deadlift = repos.exercise.search({ query: "Deadlift" });
    expect(
      deadlift.some((e) => e.equipment === "barbell" && e.name.toLowerCase().includes("deadlift")),
    ).toBe(true);
  });

  it("H/J: dumbbell, cable and machine searches all return their own equipment", () => {
    const { repos } = openSeeded();
    expect(repos.exercise.search({ query: "Dumbbell Bench Press" }).some((e) => e.equipment === "dumbbell")).toBe(true);
    expect(repos.exercise.search({ query: "cable" }).some((e) => e.equipment === "cable")).toBe(true);
    expect(repos.exercise.search({ query: "machine" }).some((e) => e.equipment === "machine")).toBe(true);
  });

  it("K: unsupported-rank exercises remain selectable and loggable in both contexts", () => {
    const { repos, services } = openSeeded();
    const all = repos.exercise.search({});
    const target =
      all.find((e) => e.rankingEligibility === "unsupported" && e.trackingType === "weight_reps" && e.equipment != null) ??
      all.find((e) => e.rankingEligibility === "unsupported")!;
    expect(target.rankingEligibility).toBe("unsupported");

    // Search must not depend on ranking eligibility: the unsupported exercise
    // is visible through the exact options the default picker would use.
    const found = repos.exercise.search(
      exercisePickerSearchOptions({ query: target.name, group: null, tracking: null, equipment: undefined }),
    );
    expect(found.some((e) => e.id === target.id)).toBe(true);

    const created = services.profile.createLocalProfile({ displayName: "Tester" });
    const profileId = created.profile.id;

    // Workout context (the picker adds via WorkoutService.addExercise).
    const workout = services.workout.startEmptyWorkout(profileId, {
      startedAtUtc: "2026-01-10T10:00:00.000Z",
      timezoneOffsetMinutes: 0,
    });
    const we = services.workout.addExercise(workout.id, { exerciseId: target.id });
    const set = services.workout.addSet(we.id, { weightKg: 40, reps: 8 });
    const completed = services.workout.completeSet(set.id, "2026-01-10T10:05:00.000Z");
    expect(completed.set.completedAt).not.toBeNull();
    const detail = services.workout.getWorkout(workout.id);
    const block = detail.exercises.find((x) => x.workoutExercise.exerciseId === target.id);
    expect(block).toBeDefined();
    expect(block!.sets.some((s) => s.completedAt != null)).toBe(true);

    // Routine context (the picker adds via RoutineService.addExercise).
    const routine = services.routine.create(profileId, "Unsupported Day");
    expect(() => services.routine.addExercise(routine.id, { exerciseId: target.id })).not.toThrow();
  });
});

// ---------------------- L: one picker, one semantics for both contexts --

describe("workout and routine pickers share the same catalog semantics (L)", () => {
  it("opens one shared picker screen from both contexts", () => {
    const workoutScreen = src(...MOBILE, "features", "workout", "ActiveWorkoutScreen.tsx");
    const routineScreen = src(...MOBILE, "app", "routine", "[id].tsx");
    expect(workoutScreen).toContain("/exercise-picker?context=workout&id=");
    expect(routineScreen).toContain("/exercise-picker?context=routine&id=");
  });

  it("the shared screen builds its search from one context-free options path", () => {
    const source = compact(pickerSource());
    // Exactly one repository search call, fed exclusively by the shared builder.
    expect(pickerSource().split("repos.exercise.search").length - 1).toBe(1);
    expect(source).toContain("repos.exercise.search( exercisePickerSearchOptions({");
    // Context only selects the target container (workout vs routine), never
    // the catalog query - so both pickers behave identically.
    expect(source).toContain('params.context === "routine" ? "routine" : "workout"');
  });
});

// ------------ display-label policy: no null-equipment bodyweight fallback --

describe("null equipment is never labelled bodyweight anywhere (F, G)", () => {
  const displayFiles = [
    ["app", "exercise-picker.tsx"],
    ["features", "workout", "ExerciseCard.tsx"],
    ["app", "(tabs)", "exercises.tsx"],
    ["app", "exercise", "[id].tsx"],
  ];

  for (const rel of displayFiles) {
    it("keeps " + rel.join("/") + " honest", () => {
      const source = src(...MOBILE, ...rel);
      expect(source).not.toContain('?? "bodyweight"');
      expect(source).toContain("equipmentLabel(");
    });
  }
});
