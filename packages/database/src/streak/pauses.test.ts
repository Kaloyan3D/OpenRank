import { describe, expect, it } from "vitest";
import { SchedulePauseOverlapError, RescheduleError } from "../services";
import {
  setup, configureSchedule, reconcile, processStreak, completeWorkoutOn, noon, cacheOf,
} from "./helpers";

const MON = "2026-02-02";
const TUE = "2026-02-03";
const WED = "2026-02-04";
const THU = "2026-02-05";
const FRI = "2026-02-06";
const SAT = "2026-02-07";
const SUN = "2026-02-08";
const MON2 = "2026-02-09";

describe("Planned pauses / vacation (spec W/X/Y/AZ)", () => {
  it("pause over one scheduled day: paused session neither increments nor breaks", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 4] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON);
    processStreak(ctx, noon(MON)); // streak 1
    ctx.services.schedule.addPause(ctx.profileId, THU, THU, "illness", { todayUtc: noon(MON) });
    processStreak(ctx, noon(THU));
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, THU)?.status).toBe("paused");
    expect(cacheOf(ctx).currentStreak).toBe(1);
    // Week final (Monday completed, Thursday paused): perfect week.
    expect(cacheOf(ctx).perfectWeeks).toBe(1);
  });

  it("the spec X example: streak 18 -> vacation week paused -> next completion = 19", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2, 4] });
    // Build an honest 18-completion ledger (the ledger is the only truth).
    for (let i = 0; i < 18; i += 1) {
      const date = "2026-01-" + String(5 + i).padStart(2, "0");
      ctx.repos.scheduledSessions.generateIfMissing({
        id: "seed-" + String(i), profileId: ctx.profileId, scheduledDate: date,
        routineId: null, scheduleRevision: 1, now: "2026-01-05T00:00:00.000Z",
      });
      ctx.repos.scheduledSessions.setStatus("seed-" + String(i), "completed", "2026-01-05T00:00:00.000Z");
    }
    ctx.services.streak.rebuildAllStreakState(ctx.profileId);
    expect(cacheOf(ctx).currentStreak).toBe(18);
    // Vacation over the coming week: Mon..Sun paused.
    ctx.services.schedule.addPause(ctx.profileId, MON, SUN, "vacation", { todayUtc: noon(MON) });
    reconcile(ctx, noon(MON));
    for (const d of [MON, TUE, THU]) {
      expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, d)?.status).toBe("paused");
    }
    processStreak(ctx, noon(SUN));
    expect(cacheOf(ctx).currentStreak).toBe(18);
    // First required workout after the vacation continues the streak.
    reconcile(ctx, noon(MON2));
    completeWorkoutOn(ctx, MON2);
    processStreak(ctx, noon(MON2));
    expect(cacheOf(ctx).currentStreak).toBe(19);
  });

  it("pause spanning a weekend/week boundary keeps both weeks neutral", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [5, 6, 1] });
    reconcile(ctx, noon(FRI));
    ctx.services.schedule.addPause(ctx.profileId, FRI, MON2, "trip", { todayUtc: noon(FRI) });
    reconcile(ctx, noon(FRI));
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, FRI)?.status).toBe("paused");
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, SAT)?.status).toBe("paused");
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON2)?.status).toBe("paused");
    processStreak(ctx, noon(MON2));
    const c = cacheOf(ctx);
    expect(c.currentStreak).toBe(0); // nothing completed yet
    expect(c.bestStreak).toBe(0); // nothing missed either - neutral
    expect(c.perfectWeeks).toBe(0); // neither week had non-paused obligations
  });

  it("retroactive miss rescue is rejected: finalized misses stay missed (spec Y)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    processStreak(ctx, noon(TUE)); // Monday missed (finalized)
    const missed = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!;
    expect(missed.status).toBe("missed");
    // A pause covering the past must NOT resurrect the miss.
    ctx.services.schedule.addPause(ctx.profileId, MON, TUE, "oops", { todayUtc: noon(TUE) });
    processStreak(ctx, noon(TUE));
    expect(ctx.repos.scheduledSessions.getById(missed.id)!.status).toBe("missed");
    expect(cacheOf(ctx).currentStreak).toBe(0);
  });

  it("an unfinalized (never-processed) pending session inside a pause becomes paused, not missed", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2] });
    reconcile(ctx, noon(MON)); // Mon + Tue generated; nothing processed
    // The user was away since Monday; pause added on Tuesday BEFORE any expiry ran.
    ctx.services.schedule.addPause(ctx.profileId, MON, TUE, "vacation", { todayUtc: noon(TUE) });
    processStreak(ctx, noon(TUE));
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)?.status).toBe("paused");
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, TUE)?.status).toBe("paused");
    expect(cacheOf(ctx).bestStreak).toBe(0); // no misses were manufactured
  });

  it("removing a future pause reopens pending sessions; overlapping pauses are rejected", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 4] });
    reconcile(ctx, noon(MON));
    const pause = ctx.services.schedule.addPause(ctx.profileId, THU, THU, null, { todayUtc: noon(MON) });
    reconcile(ctx, noon(MON));
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, THU)?.status).toBe("paused");
    ctx.services.schedule.removeFuturePause(pause.id, { todayUtc: noon(MON) });
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, THU)?.status).toBe("pending");
    // overlap
    ctx.services.schedule.addPause(ctx.profileId, WED, FRI, null, { todayUtc: noon(MON) });
    expect(() =>
      ctx.services.schedule.addPause(ctx.profileId, THU, SAT, null, { todayUtc: noon(MON) }),
    ).toThrow(SchedulePauseOverlapError);
  });

  it("a fully elapsed pause is history and cannot be removed", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    const pause = ctx.services.schedule.addPause(ctx.profileId, MON, MON, null, { todayUtc: noon(MON) });
    expect(() =>
      ctx.services.schedule.removeFuturePause(pause.id, { todayUtc: noon(TUE) }),
    ).toThrow(RescheduleError);
  });

  it("pauses inside the horizon pause sessions as soon as they are generated", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2, 3, 4, 5, 6, 7] });
    ctx.services.schedule.addPause(ctx.profileId, "2026-02-20", "2026-02-24", null, { todayUtc: noon(MON) });
    reconcile(ctx, noon(MON));
    for (const d of ["2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23", "2026-02-24"]) {
      expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, d)?.status).toBe("paused");
    }
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, "2026-02-19")?.status).toBe("pending");
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, "2026-02-25")?.status).toBe("pending");
  });
});