import { describe, expect, it } from "vitest";
import { NodeSqliteDriver } from "../node-driver";
import { openDatabase } from "../index";
import { cleanupFileDb, openTestDb, openTestFileDb } from "../testing/helpers";
import { createServices } from "./index";

function clock(startIso: string, stepMs = 1000) {
  let ms = Date.parse(startIso);
  return () => {
    const iso = new Date(ms).toISOString();
    ms += stepMs;
    return iso;
  };
}

describe("RestTimerService", () => {
  it("starts, derives remaining time from the timestamp, +15/-15, skip", () => {
    // Stepping clock, 1s per now() call - assertions account for the ticks.
    const db = openTestDb(false);
    const now = clock("2026-02-01T10:00:00.000Z");
    const { workout, restTimer } = createServices(db.driver, db.repos, { now });
    const profile = db.repos.profile.ensureDefault();
    const w = workout.startEmptyWorkout(profile.id);

    restTimer.start(profile.id, w.id, 90);
    const t1 = restTimer.getActive(profile.id)!;
    expect(t1.remainingSeconds).toBe(89); // the clock ticked once in start()
    expect(t1.expired).toBe(false);
    expect(t1.workoutId).toBe(w.id);

    // +15 extends, -15 shortens; duration stays the configured rest length.
    restTimer.addSeconds(profile.id, 15);
    const extended = restTimer.getActive(profile.id)!;
    expect(extended.remainingSeconds).toBe(89 + 15 - 1);
    expect(extended.durationSeconds).toBe(90);
    restTimer.addSeconds(profile.id, -30);
    const shortened = restTimer.getActive(profile.id)!;
    expect(shortened.remainingSeconds).toBe(89 + 15 - 30 - 2);
    expect(shortened.expired).toBe(false);

    restTimer.skip(profile.id);
    expect(restTimer.getActive(profile.id)).toBeNull();
  });

  it("reports expired (remaining 0) when ends_at is in the past, until cleared", () => {
    const db = openTestDb(false);
    // Services pinned to a fixed past instant: start a real workout, then a
    // 5 second rest that is already over when read with the later clock.
    const pastNow = () => "2026-02-01T09:00:00.000Z";
    const { workout, restTimer: pastTimer } = createServices(db.driver, db.repos, { now: pastNow });
    const profile = db.repos.profile.ensureDefault();
    const w = workout.startEmptyWorkout(profile.id);
    pastTimer.start(profile.id, w.id, 5);

    const now = clock("2026-02-01T10:00:00.000Z");
    const { restTimer } = createServices(db.driver, db.repos, { now });
    const state = restTimer.getActive(profile.id)!;
    expect(state.expired).toBe(true);
    expect(state.remainingSeconds).toBe(0);
    // The row stays until skip/clear/restart - the UI shows "done".
    expect(db.driver.get("SELECT COUNT(*) AS n FROM rest_timer")?.n).toBe(1);
    restTimer.skip(profile.id);
    expect(restTimer.getActive(profile.id)).toBeNull();
  });

  it("upserts: only one timer per profile survives", () => {
    const db = openTestDb(false);
    const now = clock("2026-02-01T10:00:00.000Z");
    const { workout, restTimer } = createServices(db.driver, db.repos, { now });
    const profile = db.repos.profile.ensureDefault();
    const w1 = workout.startEmptyWorkout(profile.id);
    restTimer.start(profile.id, w1.id, 60);
    restTimer.start(profile.id, w1.id, 120);
    const rows = db.driver.all("SELECT * FROM rest_timer");
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.duration_seconds)).toBe(120);
  });

  it("survives a full database close/reopen (process restart)", () => {
    const file = openTestFileDb();
    const now = () => "2026-02-01T10:00:00.000Z"; // fixed clock: exact assertions
    try {
      const services = createServices(file.driver, file.repos, { now });
      const profile = file.repos.profile.ensureDefault();
      const w = services.workout.startEmptyWorkout(profile.id);
      services.restTimer.start(profile.id, w.id, 300);
      const endsAt = services.restTimer.getActive(profile.id)!.endsAt;
      expect(endsAt).toBe("2026-02-01T10:05:00.000Z"); // fixed clock
      file.driver.close();

      const driver2 = new NodeSqliteDriver(file.path);
      try {
        const repos2 = openDatabase(driver2);
        const services2 = createServices(driver2, repos2, { now });
        const state = services2.restTimer.getActive(profile.id)!;
        expect(state.workoutId).toBe(w.id);
        expect(state.endsAt).toBe(endsAt);
        expect(state.remainingSeconds).toBe(300); // fixed clock: exact
        expect(state.expired).toBe(false);
      } finally {
        driver2.close();
      }
    } finally {
      cleanupFileDb(file.dir);
    }
  });
});