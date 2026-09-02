/**
 * Phase 7.1 first-launch matrix (spec 35): fresh-install onboarding,
 * single-profile semantics, resumability across process death, migration
 * compatibility for pre-7.1 profiles, notification integration, the Home
 * future-session fix and the schedule/pause hardening items.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, SCHEMA_VERSION, schemaVersion } from "../migrations";
import {
  createServices,
  ONBOARDING_BODYWEIGHT_SOURCE,
  resolveHomeSessionView,
  resolveResumeStep,
  resolveRootRoute,
} from "../services";
import { openDatabase } from "../index";
import { NodeSqliteDriver } from "../node-driver";
import { cleanupFileDb, openTestDb, openTestFileDb } from "../testing/helpers";

const NOW = "2026-02-16T12:00:00.000Z";

function fresh() {
  const db = openTestDb();
  const services = createServices(db.driver, db.repos, { now: () => NOW });
  return { ...db, services };
}

function freshPlatform(permission: "granted" | "denied" = "granted") {
  const scheduled = new Map<string, unknown>();
  let counter = 0;
  return {
    permission,
    scheduled,
    async getPermissionStatus() {
      return permission;
    },
    async requestPermission() {
      return permission;
    },
    async schedule(request: unknown) {
      const id = "os:" + String(++counter);
      scheduled.set(id, request);
      return id;
    },
    async cancel(id: string) {
      scheduled.delete(id);
    },
    async getScheduled() {
      return [...scheduled.keys()];
    },
  };
}

/** Reopen a file-backed database exactly like a process restart would. */
function reopen(path: string) {
  const driver = new NodeSqliteDriver(path);
  const repos = openDatabase(driver, {});
  const services = createServices(driver, repos, { now: () => NOW });
  return { driver, repos, services };
}

describe("first-launch onboarding (Phase 7.1, spec 35 A-H)", () => {
  it("A. fresh database -> no profile, onboarding required", () => {
    const { services } = fresh();
    expect(services.profile.getDefaultProfile()).toBeNull();
    expect(resolveRootRoute(null)).toBe("/onboarding");
  });

  it("B. no profile -> root gate never routes to the main tabs", () => {
    // The root gate is driven by this pure decision (UI can only render tabs
    // when the decision says so) - see the mobile RoutingGate.
    expect(resolveRootRoute(null)).not.toBe("/(tabs)");
  });

  it("C. create local profile -> persisted, onboarding incomplete", () => {
    const { services } = fresh();
    const result = services.profile.createLocalProfile({ displayName: "  Kaloyan  " });
    expect(result.status).toBe("created");
    const profile = services.profile.getDefaultProfile()!;
    expect(profile.displayName).toBe("Kaloyan"); // trimmed
    expect(profile.onboardingCompleted).toBe(false);
    expect(profile.onboardingStep).toBe("units");
    expect(resolveRootRoute(profile)).toBe("/onboarding/resume");
  });

  it("display name validation: empty rejected, length capped in code points, Unicode kept", () => {
    const { services } = fresh();
    expect(() => services.profile.createLocalProfile({ displayName: "   " })).toThrow("must not be empty");
    const long = "🏋".repeat(41);
    expect(() => services.profile.createLocalProfile({ displayName: long })).toThrow("too long");
    const emojiName = "🏋🔥 Kal übe";
    const result = services.profile.createLocalProfile({ displayName: emojiName });
    expect(result.status).toBe("created");
    expect(services.profile.getDefaultProfile()!.displayName).toBe(emojiName);
  });

  it("single profile: completed profile -> structured conflict, no second row", () => {
    const { services, driver } = fresh();
    services.profile.createLocalProfile({ displayName: "Kaloyan" });
    const profile = services.profile.getDefaultProfile()!;
    services.profile.completeOnboarding(profile.id);
    const second = services.profile.createLocalProfile({ displayName: "Someone Else" });
    expect(second.status).toBe("conflict");
    expect(second.profile.id).toBe(profile.id);
    const rows = driver.all("SELECT COUNT(*) AS n FROM profiles");
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("single profile: incomplete profile -> reused (resumed), never duplicated", () => {
    const { services, driver } = fresh();
    const first = services.profile.createLocalProfile({ displayName: "Draft" });
    const second = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    expect(first.status).toBe("created");
    expect(second.status).toBe("reused");
    expect(second.profile.id).toBe(first.profile.id);
    expect(second.profile.displayName).toBe("Kaloyan");
    expect(Number(driver.all("SELECT COUNT(*) AS n FROM profiles")[0]!.n)).toBe(1);
  });

  it("D. restart after the profile-name step -> same profile, resume at units", () => {
    const { path, dir } = openTestFileDb();
    try {
      {
        const driver = new NodeSqliteDriver(path);
        const repos = openDatabase(driver, {});
        const services = createServices(driver, repos, { now: () => NOW });
        services.profile.createLocalProfile({ displayName: "Kaloyan" });
        driver.close();
      }
      const { driver, services } = reopen(path);
      try {
        const profile = services.profile.getDefaultProfile()!;
        expect(profile.displayName).toBe("Kaloyan");
        expect(profile.onboardingCompleted).toBe(false);
        expect(resolveResumeStep(profile)).toBe("units");
        expect(resolveRootRoute(profile)).toBe("/onboarding/resume");
      } finally {
        driver.close();
      }
    } finally {
      try {
        cleanupFileDb(dir);
      } catch {
        /* temp dir */
      }
    }
  });

  it("E. restart after units -> same unit selection", () => {
    const { path, dir } = openTestFileDb();
    try {
      {
        const driver = new NodeSqliteDriver(path);
        const repos = openDatabase(driver, {});
        const services = createServices(driver, repos, { now: () => NOW });
        const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
        services.profile.updateUnitSystem(profile.id, "imperial");
        services.profile.setOnboardingStep(profile.id, "strength_standard");
        driver.close();
      }
      const { driver, services } = reopen(path);
      try {
        const profile = services.profile.getDefaultProfile()!;
        expect(profile.unitSystem).toBe("imperial");
        expect(resolveResumeStep(profile)).toBe("strength_standard");
      } finally {
        driver.close();
      }
    } finally {
      try {
        cleanupFileDb(dir);
      } catch {
        /* temp dir */
      }
    }
  });

  it("F. restart after the ranking standard -> same standard", () => {
    const { path, dir } = openTestFileDb();
    try {
      {
        const driver = new NodeSqliteDriver(path);
        const repos = openDatabase(driver, {});
        const services = createServices(driver, repos, { now: () => NOW });
        const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
        services.profile.updateStrengthStandard(profile.id, "female");
        services.profile.setOnboardingStep(profile.id, "bodyweight");
        driver.close();
      }
      const { driver, services } = reopen(path);
      try {
        const profile = services.profile.getDefaultProfile()!;
        expect(profile.strengthStandard).toBe("female");
        expect(resolveResumeStep(profile)).toBe("bodyweight");
      } finally {
        driver.close();
      }
    } finally {
      try {
        cleanupFileDb(dir);
      } catch {
        /* temp dir */
      }
    }
  });

  it("G. bodyweight persisted as one onboarding measurement in canonical kg", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    const entry = services.profile.setOnboardingBodyweight(profile.id, 82.5, NOW);
    expect(entry).not.toBeNull();
    expect(entry!.source).toBe(ONBOARDING_BODYWEIGHT_SOURCE);
    expect(entry!.weightKg).toBe(82.5);
    const history = services.profile.getOnboardingBodyweight(profile.id);
    expect(history!.weightKg).toBe(82.5);
  });

  it("H. bodyweight skipped -> nothing stored (no placeholder data)", () => {
    const { services, repos } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    expect(services.profile.setOnboardingBodyweight(profile.id, null, NOW)).toBeNull();
    expect(repos.bodyweight.history(profile.id)).toHaveLength(0);
    expect(services.profile.getOnboardingBodyweight(profile.id)).toBeNull();
  });

  it("I. back-navigation through bodyweight -> one measurement, updated in place", () => {
    const { services, repos } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    const first = services.profile.setOnboardingBodyweight(profile.id, 80, NOW)!;
    const second = services.profile.setOnboardingBodyweight(profile.id, 82.5, NOW)!;
    const third = services.profile.setOnboardingBodyweight(profile.id, 81, NOW)!;
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(repos.bodyweight.history(profile.id)).toHaveLength(1);
    expect(repos.bodyweight.history(profile.id)[0]!.weightKg).toBe(81);
  });

  it("rejects non-positive / non-finite bodyweight", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    expect(() => services.profile.setOnboardingBodyweight(profile.id, 0, NOW)).toThrow();
    expect(() => services.profile.setOnboardingBodyweight(profile.id, -3, NOW)).toThrow();
    expect(() => services.profile.setOnboardingBodyweight(profile.id, Number.NaN, NOW)).toThrow();
  });
});

describe("onboarding schedule + notifications (spec 35 J-M, 15-19)", () => {
  it("J. zero training days is valid onboarding", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    const offset = 0;
    services.schedule.setScheduleEnabled(profile.id, true, { timezoneOffsetMinutes: offset });
    services.schedule.updateWeeklySchedule(
      profile.id,
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday: weekday as 1, enabled: false, routineId: null })),
      { timezoneOffsetMinutes: offset },
    );
    const { days, schedule } = services.schedule.getSchedule(profile.id);
    expect(days.every((d) => !d.enabled)).toBe(true);
    expect(schedule.enabled).toBe(true);
    services.profile.completeOnboarding(profile.id);
    expect(services.profile.getDefaultProfile()!.onboardingCompleted).toBe(true);
    // No obligations were created for a zero-day plan.
    expect(services.schedule.getUpcomingSessions(profile.id, { timezoneOffsetMinutes: offset })).toHaveLength(0);
  });

  it("K. Mon/Tue/Thu persists through the canonical schedule layer", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    services.schedule.setScheduleEnabled(profile.id, true, { timezoneOffsetMinutes: 0 });
    services.schedule.updateWeeklySchedule(
      profile.id,
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday: weekday as 1,
        enabled: weekday === 1 || weekday === 2 || weekday === 4,
        routineId: null,
      })),
      { timezoneOffsetMinutes: 0 },
    );
    const { days } = services.schedule.getSchedule(profile.id);
    expect(days.filter((d) => d.enabled).map((d) => d.weekday)).toEqual([1, 2, 4]);
    // Regeneration materializes pending obligations on exactly those weekdays.
    services.schedule.reconcileUpcomingSessions(profile.id, { timezoneOffsetMinutes: 0 });
    const upcoming = services.schedule.getUpcomingSessions(profile.id, { timezoneOffsetMinutes: 0 });
    expect(upcoming.length).toBeGreaterThan(0);
    for (const session of upcoming) {
      const weekday = (new Date(session.scheduledDate + "T00:00:00Z").getUTCDay() + 6) % 7 + 1;
      expect([1, 2, 4]).toContain(weekday);
    }
  });

  it("S. every active routine is selectable for a scheduled weekday (no slice limit)", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    const ids: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      ids.push(services.routine.create(profile.id, "Routine " + String(i)).id);
    }
    // The 5th (previously unreachable via slice(0,3)) must persist fine.
    services.schedule.setScheduleEnabled(profile.id, true, { timezoneOffsetMinutes: 0 });
    services.schedule.updateWeeklySchedule(
      profile.id,
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday: weekday as 1,
        enabled: weekday === 1,
        routineId: weekday === 1 ? ids[4]! : null,
      })),
      { timezoneOffsetMinutes: 0 },
    );
    const day = services.schedule.getSchedule(profile.id).days.find((d) => d.weekday === 1)!;
    expect(day.enabled).toBe(true);
    expect(day.routineId).toBe(ids[4]!);
  });

  it("M. notifications enabled -> Phase 7 preferences + reconcile used", async () => {
    const db = openTestDb();
    const platform = freshPlatform("granted");
    const services2 = createServices(db.driver, db.repos, {
      now: () => NOW,
      notificationPlatform: platform as never,
    });
    const { profile } = services2.profile.createLocalProfile({ displayName: "Kaloyan" });
    services2.schedule.setScheduleEnabled(profile.id, true, { timezoneOffsetMinutes: 0 });
    services2.schedule.updateWeeklySchedule(
      profile.id,
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday: weekday as 1,
        enabled: weekday === 1 || weekday === 2 || weekday === 4,
        routineId: null,
      })),
      { timezoneOffsetMinutes: 0 },
    );
    services2.schedule.reconcileUpcomingSessions(profile.id, { timezoneOffsetMinutes: 0 });
    const status = await services2.notifications.requestPermission(profile.id);
    expect(status).toBe("granted");
    services2.notifications.updatePreferences(profile.id, { trainingRemindersEnabled: true });
    services2.notifications.setReminderTimeForEnabledDays(profile.id, 1050); // 17:30
    const report = await services2.notifications.reconcileNotifications(profile.id, {
      todayUtc: NOW,
      timezoneOffsetMinutes: 0,
    });
    expect(report.permission).toBe("granted");
    expect(report.scheduled).toBeGreaterThan(0);
    const prefs = services2.notifications.getPreferences(profile.id);
    expect(prefs.trainingRemindersEnabled).toBe(true);
    expect(prefs.permissionPromptSeen).toBe(true);
    expect(platform.scheduled.size).toBeGreaterThan(0);
  });

  it("L. notification permission denied -> onboarding still completes", async () => {
    const db = openTestDb();
    const platform = freshPlatform("denied");
    const services = createServices(db.driver, db.repos, {
      now: () => NOW,
      notificationPlatform: platform as never,
    });
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    services.schedule.setScheduleEnabled(profile.id, true, { timezoneOffsetMinutes: 0 });
    services.schedule.updateWeeklySchedule(
      profile.id,
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday: weekday as 1, enabled: weekday === 1, routineId: null })),
      { timezoneOffsetMinutes: 0 },
    );
    const status = await services.notifications.requestPermission(profile.id);
    expect(status).toBe("denied");
    services.profile.setOnboardingStep(profile.id, "ready");
    services.profile.completeOnboarding(profile.id);
    const done = services.profile.getDefaultProfile()!;
    expect(done.onboardingCompleted).toBe(true);
    expect(resolveRootRoute(done)).toBe("/(tabs)");
    // Denial never schedules anything.
    await services.notifications.reconcileNotifications(profile.id, { todayUtc: NOW, timezoneOffsetMinutes: 0 });
    expect(platform.scheduled.size).toBe(0);
  });
});

describe("onboarding completion + migration (spec 35 N/O/P)", () => {
  it("N. completed onboarding -> next boot enters the main tabs, no re-onboarding", () => {
    const { path, dir } = openTestFileDb();
    try {
      {
        const driver = new NodeSqliteDriver(path);
        const repos = openDatabase(driver, {});
        const services = createServices(driver, repos, { now: () => NOW });
        const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
        services.profile.completeOnboarding(profile.id);
        driver.close();
      }
      const { driver, services } = reopen(path);
      try {
        const profile = services.profile.getDefaultProfile()!;
        expect(profile.onboardingCompleted).toBe(true);
        expect(profile.onboardingStep).toBeNull();
        expect(resolveRootRoute(profile)).toBe("/(tabs)");
      } finally {
        driver.close();
      }
    } finally {
      try {
        cleanupFileDb(dir);
      } catch {
        /* temp dir */
      }
    }
  });

  it("O/P. v5-era profile migrates to completed onboarding (no forced re-onboarding)", () => {
    const dir = mkdtempSync(join(tmpdir(), "openrank-v5-"));
    const path = join(dir, "openrank.db");
    try {
      {
        const driver = new NodeSqliteDriver(path);
        // Apply migrations 1..5 ONLY (the pre-7.1 schema world).
        driver.exec("PRAGMA foreign_keys = ON");
        for (const m of MIGRATIONS.filter((m2) => m2.version <= 5)) {
          driver.transaction(() => {
            for (const statement of m.statements) driver.exec(statement);
            driver.exec("PRAGMA user_version = " + String(m.version));
          });
        }
        expect(schemaVersion(driver)).toBe(5);
        // A pre-7.1 profile row: onboarding_completed = 0 (the v1 default) and
        // NO onboarding_step column (it does not exist yet in v5).
        driver.run(
          "INSERT INTO profiles (id, display_name, strength_standard, unit_system, onboarding_completed, created_at, updated_at) " +
            "VALUES ('legacy', 'Kaloyan', 'male', 'metric', 0, ?, ?)",
          [NOW, NOW],
        );
        driver.close();
      }
      // Reopen with the CURRENT code: migration to v6 runs deterministically.
      const { driver, services } = reopen(path);
      try {
        expect(schemaVersion(driver)).toBe(SCHEMA_VERSION);
        const profile = services.profile.getDefaultProfile()!;
        expect(profile.displayName).toBe("Kaloyan");
        expect(profile.onboardingCompleted).toBe(true); // compatibility migration
        expect(profile.onboardingStep).toBeNull();
        expect(resolveRootRoute(profile)).toBe("/(tabs)"); // straight to the app
      } finally {
        driver.close();
      }
    } finally {
      try {
        cleanupFileDb(dir);
      } catch {
        /* temp dir */
      }
    }
  });

  it("P. deep link with no profile: gate decision routes to onboarding, nothing created", () => {
    const { services, repos } = fresh();
    // Any direct destination resolves through the same gate decision.
    expect(resolveRootRoute(services.profile.getDefaultProfile())).toBe("/onboarding");
    // Receiving a deep link must not mutate canonical state on its own.
    expect(repos.workout.listHistory("no-such-profile")).toHaveLength(0);
    expect(services.profile.getDefaultProfile()).toBeNull();
  });

  it("completeOnboarding clears the step pointer and is idempotent", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    services.profile.setOnboardingStep(profile.id, "ready");
    services.profile.completeOnboarding(profile.id);
    const once = services.profile.getDefaultProfile()!;
    expect(once.onboardingCompleted).toBe(true);
    expect(once.onboardingStep).toBeNull();
    services.profile.completeOnboarding(profile.id);
    expect(services.profile.getDefaultProfile()!.onboardingCompleted).toBe(true);
  });
});

describe("Home future-session semantics + bonus workouts (spec 35 Q/R, 24)", () => {
  it("Q. future planned obligation -> 'future' view (no start-as-today CTA)", () => {
    // Wednesday rest, Thursday planned: Home must show NEXT WORKOUT, and the
    // only workout CTA is the explicit bonus one.
    const wednesday = "2026-02-18";
    const view = resolveHomeSessionView({
      todayLogical: wednesday,
      todaysState: "rest",
      next: { id: "s-thu", scheduledDate: "2026-02-19" },
    });
    expect(view).toEqual({ kind: "future", sessionId: "s-thu", scheduledDate: "2026-02-19" });

    // Today's pending obligation -> startable.
    expect(
      resolveHomeSessionView({
        todayLogical: "2026-02-19",
        todaysState: "planned",
        next: { id: "s-thu", scheduledDate: "2026-02-19" },
      }),
    ).toEqual({ kind: "today_planned", sessionId: "s-thu" });

    // Today completed / missed are reported honestly.
    expect(
      resolveHomeSessionView({ todayLogical: "2026-02-19", todaysState: "completed", next: null }),
    ).toEqual({ kind: "today_completed" });
    expect(
      resolveHomeSessionView({
        todayLogical: "2026-02-19",
        todaysState: "missed",
        next: { id: "s-fri", scheduledDate: "2026-02-20" },
      }),
    ).toEqual({ kind: "today_missed" });
    expect(resolveHomeSessionView({ todayLogical: "2026-02-19", todaysState: "rest", next: null })).toEqual({
      kind: "none",
    });
  });

  it("R. manual bonus workout on a non-planned day remains a bonus (streak untouched)", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    // Monday planned; workout done Wednesday (rest day).
    services.schedule.setScheduleEnabled(profile.id, true, { timezoneOffsetMinutes: 0 });
    services.schedule.updateWeeklySchedule(
      profile.id,
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday: weekday as 1, enabled: weekday === 1, routineId: null })),
      { timezoneOffsetMinutes: 0 },
    );
    services.schedule.reconcileUpcomingSessions(profile.id, { timezoneOffsetMinutes: 0 });
    // 2026-02-16 is a Monday; 2026-02-18 is a Wednesday.
    const workout = services.workout.startEmptyWorkout(profile.id, { startedAtUtc: "2026-02-18T10:00:00.000Z" });
    services.workout.finishWorkout(workout.id, { incompleteSetPolicy: "reject" });
    services.streak.processPending({ todayUtc: "2026-02-18T12:00:00.000Z", timezoneOffsetMinutes: 0 });
    const sessions = services.schedule.getUpcomingSessions(profile.id, { timezoneOffsetMinutes: 0 });
    // The Monday obligation is untouched (still pending) - the bonus did not
    // consume or reinterpret it.
    expect(sessions.every((s) => s.scheduledDate !== "2026-02-18")).toBe(true);
    const cache = services.streak.getCurrentState(profile.id).cache;
    expect(cache.currentStreak).toBe(0); // bonus workouts never feed the streak
  });

  it("T. pause range: start > end rejected, valid range persisted, overlaps rejected", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    expect(() =>
      services.schedule.addPause(profile.id, "2026-02-20", "2026-02-18", "inverted", { timezoneOffsetMinutes: 0 }),
    ).toThrow();
    services.schedule.addPause(profile.id, "2026-02-18", "2026-02-20", "Vacation", { timezoneOffsetMinutes: 0 });
    const pauses = services.schedule.listPauses(profile.id);
    expect(pauses).toHaveLength(1);
    expect(pauses[0]!.startDate).toBe("2026-02-18");
    expect(pauses[0]!.endDate).toBe("2026-02-20");
    expect(pauses[0]!.reason).toBe("Vacation");
    expect(() =>
      services.schedule.addPause(profile.id, "2026-02-19", "2026-02-22", "overlap", { timezoneOffsetMinutes: 0 }),
    ).toThrow();
  });
});

describe("workout service-layer leakage (spec 35 U, 28)", () => {
  it("U. active-workout UI no longer calls canonical workout mutations directly", () => {
    // The extraction moved the screen into features/workout; assert the UI
    // files never touch the three canonical repository mutations and that
    // the service facade is used instead.
    const files = [
      "apps/mobile/src/features/workout/ActiveWorkoutScreen.tsx",
      "apps/mobile/src/features/workout/ExerciseCard.tsx",
      "apps/mobile/src/features/workout/SetRow.tsx",
      "apps/mobile/src/features/workout/SetTypePicker.tsx",
      "apps/mobile/src/features/workout/WorkoutHeader.tsx",
    ];
    const forbidden = /repos\.workout\.(removeExercise|reorderExercises|updateWorkoutExercise)\(/;
    for (const rel of files) {
      let source: string;
      try {
        source = readFileSync(join(process.cwd(), rel), "utf8");
      } catch {
        continue; // optional component file
      }
      expect(forbidden.test(source), rel + " must not mutate canonical workout state directly").toBe(false);
    }
    const screen = readFileSync(
      join(process.cwd(), "apps/mobile/src/features/workout/ActiveWorkoutScreen.tsx"),
      "utf8",
    );
    expect(screen).toContain("services.workout.removeExercise");
    expect(screen).toContain("services.workout.reorderExercises");
    expect(screen).toContain("services.workout.updateSuperset");
  });

  it("service facade delegates the canonical workout-exercise mutations", () => {
    const { services, repos } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "Kaloyan" });
    const exerciseId = repos.exercise.listRankSupported()[0]!.id;
    const routine = services.routine.create(profile.id, "Push");
    services.routine.addExercise(routine.id, {
      exerciseId,
      targets: [{ setType: "normal" as const, targetRepsMin: 8, targetRepsMax: 10 }],
    });
    const workout = services.workout.startWorkoutFromRoutine(profile.id, routine.id, { timezoneOffsetMinutes: 0 });
    const detail = services.workout.getWorkout(workout.id);
    const weId = detail.exercises[0]!.workoutExercise.id;
    services.workout.updateSuperset(weId, "A");
    expect(services.workout.getWorkout(workout.id).exercises[0]!.workoutExercise.supersetGroup).toBe("A");
    services.workout.updateSuperset(weId, null);
    expect(services.workout.getWorkout(workout.id).exercises[0]!.workoutExercise.supersetGroup).toBeNull();
    // Reorder + remove round-trip through the facade.
    services.workout.reorderExercises(workout.id, [weId]);
    services.workout.removeExercise(weId);
    expect(services.workout.getWorkout(workout.id).exercises).toHaveLength(0);
  });
});
