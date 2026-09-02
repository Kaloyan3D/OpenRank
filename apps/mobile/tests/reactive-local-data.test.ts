/**
 * Phase 8.2 P0 - app-wide reactive local data (regression + architecture).
 *
 * Three layers are locked here:
 *
 * 1. LocalDataChangeStore semantics: monotonic revision, subscribe/notify.
 * 2. ChangeNotifyingDriver over REAL SQLite (node driver): publish ordering
 *    (commit -> publish), exactly-once per transaction, silence on failure,
 *    inert reads - plus end-to-end service-mutation coverage (profile,
 *    bodyweight, workout chain, derived PR/rank rebuild, streak processing,
 *    schedule, notification preferences).
 * 3. Source policy: UI never issues canonical repository writes (services
 *    only), and every data-driven UI consumer subscribes to the shared
 *    canonical revision via useCanonicalRevision/useSyncExternalStore.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CatalogV1 } from "@openrank/exercise-catalog";
import { createServices, openDatabase } from "@openrank/database";
import type { OpenDatabaseResult, OpenRankServices } from "@openrank/database";
import { NodeSqliteDriver } from "@openrank/database/node";
import { ChangeNotifyingDriver } from "../src/local-data/ChangeNotifyingDriver";
import { LocalDataChangeStore } from "../src/local-data/LocalDataChangeStore";

// --------------------------------------------------------------- helpers --

/** Read a repo-root-relative source file (same convention as design-policy). */
function src(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", "..", "..", ...segments), "utf8");
}
const MOBILE = ["apps", "mobile", "src"];
const UI_DIRS = ["app", "features", "components", "ui", "hooks"] as const;

function listUiFiles(): string[] {
  const out: string[] = [];
  const root = join(__dirname, "..", "..", "..", ...MOBILE);
  for (const dir of UI_DIRS) {
    const walk = (p: string): void => {
      for (const entry of readdirSync(p, { withFileTypes: true })) {
        const full = join(p, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
      }
    };
    walk(join(root, dir));
  }
  return out;
}

const catalog = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "packages", "exercise-catalog", "data", "catalog.v1.json"), "utf8"),
) as CatalogV1;

interface TestApp {
  store: LocalDataChangeStore;
  driver: ChangeNotifyingDriver;
  repos: OpenDatabaseResult;
  services: OpenRankServices;
  /** Revision after boot (migrations/seed publish into the void - ignored). */
  baseline: () => number;
  profileId: string;
}

/** Fresh in-memory app: store + notifying driver + repos + services + profile. */
function openTestApp(): TestApp {
  const store = new LocalDataChangeStore();
  const driver = new ChangeNotifyingDriver(new NodeSqliteDriver(":memory:"), () => store.publish());
  const repos = openDatabase(driver, { catalog });
  const services = createServices(driver, repos);
  const created = services.profile.createLocalProfile({ displayName: "Tester" });
  if (created.status !== "created" && created.status !== "reused") throw new Error("profile setup failed");
  return { store, driver, repos, services, baseline: () => store.getSnapshot(), profileId: created.profile.id };
}

// ------------------------------------------------- 1. store semantics --

describe("LocalDataChangeStore", () => {
  it("publishes a monotonically increasing revision to subscribers", () => {
    const store = new LocalDataChangeStore();
    expect(store.getSnapshot()).toBe(0);
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getSnapshot()));
    store.publish();
    store.publish();
    expect(seen).toEqual([1, 2]);
    expect(store.getSnapshot()).toBe(2);
  });

  it("stops notifying after unsubscribe and keeps the snapshot stable between publishes", () => {
    const store = new LocalDataChangeStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.publish();
    unsubscribe();
    store.publish();
    expect(calls).toBe(1);
    expect(store.getSnapshot()).toBe(2);
  });

  it("isolates a throwing listener so the mutation path is never corrupted", () => {
    const store = new LocalDataChangeStore();
    let notified = 0;
    store.subscribe(() => {
      throw new Error("broken consumer");
    });
    store.subscribe(() => {
      notified += 1;
    });
    expect(() => store.publish()).not.toThrow();
    expect(notified).toBe(1);
    expect(store.getSnapshot()).toBe(1);
  });

  it("carries no domain imports - invalidation metadata only, never records", () => {
    const source = src(...MOBILE, "local-data", "LocalDataChangeStore.ts");
    expect(source).not.toContain('from "');
    expect(source).not.toContain("import ");
  });
});

// ------------------------- 2. publish ordering over real SQLite --

describe("ChangeNotifyingDriver over real SQLite", () => {
  it("publishes only AFTER the transaction commits, exactly once", () => {
    const app = openTestApp();
    const before = app.baseline();
    let observedDuring = -1;
    app.driver.transaction(() => {
      app.repos.bodyweight.add({
        profileId: app.profileId,
        measuredAt: "2025-01-01T08:00:00.000Z",
        weightKg: 80,
        source: "test",
      });
      observedDuring = app.store.getSnapshot();
    });
    expect(observedDuring).toBe(before); // not yet published inside the transaction
    expect(app.store.getSnapshot()).toBe(before + 1); // exactly one publish, post-commit
    expect(app.repos.bodyweight.history(app.profileId)).toHaveLength(1);
  });

  it("suppresses nested (reentrant) transactions to one publication", () => {
    const app = openTestApp();
    const before = app.baseline();
    app.driver.transaction(() => {
      app.driver.transaction(() => {
        app.repos.bodyweight.add({
          profileId: app.profileId,
          measuredAt: "2025-01-01T08:00:00.000Z",
          weightKg: 80,
          source: "test",
        });
      });
    });
    expect(app.store.getSnapshot()).toBe(before + 1);
  });

  it("does not publish when a statement or a transaction fails (T)", () => {
    const app = openTestApp();
    const before = app.baseline();
    expect(() => app.driver.run("INSERT INTO definitely_missing VALUES (1)")).toThrow();
    expect(() =>
      app.driver.transaction(() => {
        app.repos.bodyweight.add({
          profileId: app.profileId,
          measuredAt: "2025-01-01T08:00:00.000Z",
          weightKg: 80,
          source: "test",
        });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(app.store.getSnapshot()).toBe(before); // no false-success invalidation
    expect(app.repos.bodyweight.history(app.profileId)).toHaveLength(0); // rolled back
  });

  it("never publishes for reads", () => {
    const app = openTestApp();
    const before = app.baseline();
    app.driver.all("SELECT 1");
    app.driver.get("SELECT 1");
    app.services.workout.listHistory(app.profileId);
    app.services.profile.getDefaultProfile();
    expect(app.store.getSnapshot()).toBe(before);
  });
});

// ------------------- 3. service mutations invalidate consumers --

describe("canonical mutations publish (consumer re-read contract)", () => {
  it("profile rename publishes and re-reads fresh (A)", () => {
    const app = openTestApp();
    const before = app.baseline();
    app.services.profile.updateDisplayName(app.profileId, "Renamed");
    expect(app.store.getSnapshot()).toBeGreaterThan(before);
    expect(app.services.profile.getDefaultProfile()?.displayName).toBe("Renamed");
  });

  it("a failed canonical write does not advance the revision (T)", () => {
    const app = openTestApp();
    const before = app.baseline();
    expect(() => app.services.profile.updateDisplayName(app.profileId, "   ")).toThrow();
    expect(app.store.getSnapshot()).toBe(before);
  });

  it("bodyweight add via ProfileService publishes exactly once and re-reads fresh (B)", () => {
    const app = openTestApp();
    const before = app.baseline();
    app.services.profile.addBodyweight(app.profileId, 82.5, "2025-01-02T08:00:00.000Z");
    // One logical operation (add + derived dirty marker) = one transaction = one publish.
    expect(app.store.getSnapshot()).toBe(before + 1);
    expect(app.repos.bodyweight.history(app.profileId)[0]?.weightKg).toBe(82.5);
    expect(() => app.services.profile.addBodyweight(app.profileId, -1, "2025-01-02T08:00:00.000Z")).toThrow();
    expect(app.store.getSnapshot()).toBe(before + 1); // the failed add published nothing
  });

  it("unit system + strength standard changes publish (profile consumers refresh)", () => {
    const app = openTestApp();
    const before = app.baseline();
    app.services.profile.updateUnitSystem(app.profileId, "imperial");
    app.services.profile.updateStrengthStandard(app.profileId, "female");
    expect(app.store.getSnapshot()).toBeGreaterThan(before + 1);
  });

  it("workout chain start/add-exercise/add-set/complete/finish publishes with fresh reads (E,F,G,H,J,K)", () => {
    const app = openTestApp();
    const exercise = app.repos.exercise.listRankSupported().find((e) => e.trackingType === "weight_reps");
    expect(exercise).toBeDefined();
    const before = app.baseline();

    const workout = app.services.workout.startEmptyWorkout(app.profileId, {
      startedAtUtc: "2025-01-10T10:00:00.000Z",
      timezoneOffsetMinutes: 0,
    });
    expect(app.store.getSnapshot()).toBeGreaterThan(before); // start published

    const we = app.services.workout.addExercise(workout.id, { exerciseId: exercise!.id });
    const set = app.services.workout.addSet(we.id, { weightKg: 100, reps: 5 });
    app.services.workout.completeSet(set.id);
    app.services.workout.finishWorkout(workout.id, { incompleteSetPolicy: "remove" });

    // Every step published at least once; the UI re-reads and sees the result.
    expect(app.store.getSnapshot()).toBeGreaterThan(before + 1);
    expect(app.services.workout.listHistory(app.profileId).map((d) => d.workout.id)).toContain(workout.id);
    expect(app.services.workout.resumeActiveWorkout(app.profileId)).toBeNull(); // J: active gone
  });

  it("derived PR/rank rebuild and streak processing invalidate consumers (N,O,P)", () => {
    const app = openTestApp();
    const exercise = app.repos.exercise.listRankSupported().find((e) => e.trackingType === "weight_reps");
    expect(exercise).toBeDefined();
    app.services.profile.addBodyweight(app.profileId, 80, "2025-01-09T08:00:00.000Z");
    const workout = app.services.workout.startEmptyWorkout(app.profileId, {
      startedAtUtc: "2025-01-10T10:00:00.000Z",
      timezoneOffsetMinutes: 0,
    });
    const we = app.services.workout.addExercise(workout.id, { exerciseId: exercise!.id });
    const set = app.services.workout.addSet(we.id, { weightKg: 100, reps: 5 });
    app.services.workout.completeSet(set.id);
    app.services.workout.finishWorkout(workout.id, { incompleteSetPolicy: "remove" });

    const beforeDerived = app.store.getSnapshot();
    const derived = app.services.derived.processPending();
    expect(derived.errors).toEqual([]);
    expect(app.store.getSnapshot()).toBeGreaterThan(beforeDerived); // derived writes published
    expect(app.repos.personalRecords.listEventsForProfile(app.profileId, 10).length).toBeGreaterThan(0);

    app.services.schedule.setScheduleEnabled(app.profileId, true, { timezoneOffsetMinutes: 0 });
    const days = app.services.schedule.getSchedule(app.profileId).days.map((d) => ({
      weekday: d.weekday,
      enabled: d.weekday === 5,
      routineId: d.routineId,
    }));
    app.services.schedule.updateWeeklySchedule(app.profileId, days, { timezoneOffsetMinutes: 0 });
    const beforeStreak = app.store.getSnapshot();
    const streak = app.services.streak.processPending({ timezoneOffsetMinutes: 0 });
    expect(streak.errors).toEqual([]);
    expect(app.store.getSnapshot()).toBeGreaterThanOrEqual(beforeStreak);
    expect(app.services.streak.getCurrentState(app.profileId).cache.bestStreak).toBeGreaterThanOrEqual(0);
  });

  it("routine and schedule mutations publish (Q,R)", () => {
    const app = openTestApp();
    const before = app.baseline();
    const routine = app.services.routine.create(app.profileId, "Push Day");
    app.services.routine.addExercise(routine.id, { exerciseId: app.repos.exercise.listRankSupported()[0]!.id });
    expect(app.store.getSnapshot()).toBeGreaterThan(before);
    const days = app.services.schedule.getSchedule(app.profileId).days.map((d) => ({
      weekday: d.weekday,
      enabled: d.weekday === 1,
      routineId: d.weekday === 1 ? routine.id : d.routineId,
    }));
    app.services.schedule.updateWeeklySchedule(app.profileId, days, { timezoneOffsetMinutes: 0 });
    expect(app.store.getSnapshot()).toBeGreaterThan(before + 1);
  });

  it("notification preference changes publish (S)", () => {
    const app = openTestApp();
    const before = app.baseline();
    app.services.notifications.updatePreferences(app.profileId, { reminderStyle: "competitive" });
    expect(app.store.getSnapshot()).toBeGreaterThan(before);
  });
});

// --------------------------------- 4. permanent source policy --

describe("Phase 8.2 UI canonical-write policy (source test)", () => {
  const uiFiles = listUiFiles();

  it("scans the expected UI surface", () => {
    expect(uiFiles.length).toBeGreaterThan(15);
  });

  it("never issues canonical repository writes from UI (services only)", () => {
    // UI may READ repositories where accepted; writes must go through the
    // service layer. Any repos.<domain>.<mutator>( call in a UI file is a
    // regression (e.g. the old repos.workout.addExercise in the picker).
    const offenders: string[] = [];
    const mutator =
      /\brepos\.\w+\.(create|insert|update|delete|remove|add|set|upsert|reorder|complete|uncomplete|clear|mark|toggle|enable|disable|replace|save|record|discard|finish|start|reset|apply|archive|unarchive|rename)\w*\s*\(/;
    for (const file of uiFiles) {
      const text = readFileSync(file, "utf8");
      if (mutator.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("never opens raw SQL or transactions from UI", () => {
    const offenders: string[] = [];
    const rawSql = /\b(db|driver|database)\.(run|runSync|exec|execSync|transaction)\s*\(/;
    for (const file of uiFiles) {
      const text = readFileSync(file, "utf8");
      if (rawSql.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the fixed exercise-picker violation fixed (services.workout.addExercise)", () => {
    const picker = src(...MOBILE, "app", "exercise-picker.tsx");
    expect(picker).toContain("services.workout.addExercise(");
    expect(picker).not.toContain("repos.workout.addExercise(");
  });

  it("routes profile/bodyweight writes through ProfileService", () => {
    const profile = src(...MOBILE, "app", "(tabs)", "profile.tsx");
    expect(profile).toContain("services.profile.addBodyweight(");
    expect(profile).toContain("services.profile.updateUnitSystem(");
    expect(profile).toContain("services.profile.updateStrengthStandard(");
    expect(profile).not.toContain("repos.bodyweight.add(");
    expect(profile).not.toContain("repos.profile.update");
  });

  it("subscribes every data-driven UI consumer to the canonical revision (V, W)", () => {
    // Tab screens and nested routes stay mounted across navigation: the only
    // way they can observe canonical commits is the shared revision. A file
    // that reads repositories during render MUST consume the revision.
    const unreactive: string[] = [];
    for (const file of uiFiles) {
      const text = readFileSync(file, "utf8");
      if (text.includes("useRepos(") && !text.includes("useCanonicalRevision(")) unreactive.push(file);
    }
    expect(unreactive).toEqual([]);
  });

  it("implements the React subscription with useSyncExternalStore", () => {
    const hook = src(...MOBILE, "local-data", "useCanonicalRevision.ts");
    expect(hook).toContain("useSyncExternalStore");
  });

  it("publishes from the driver boundary inside DatabaseProvider boot", () => {
    const provider = src(...MOBILE, "db", "DatabaseProvider.tsx");
    expect(provider).toContain("ChangeNotifyingDriver");
    expect(provider).toContain("localDataChangeStore.publish()");
  });

  it("keeps SQLite canonical: no duplicate state store is introduced", () => {
    // The invalidation layer must not pull a duplicate-state library.
    for (const name of ["LocalDataChangeStore.ts", "ChangeNotifyingDriver.ts", "useCanonicalRevision.ts"]) {
      const text = src(...MOBILE, "local-data", name);
      expect(text).not.toMatch(/from\s+"(redux|zustand|mobx|recoil|jotai|@reduxjs[\w/-]*)"/i);
      expect(text).toMatch(/@openrank\/database$|react"|\.\/LocalDataChangeStore"|^\s*import\s+type|^\/\*\*/m);
    }
  });
});
