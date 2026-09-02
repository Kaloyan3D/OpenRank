import { describe, expect, it } from "vitest";
import { isoWeekdayOf } from "../services";
import {
  setup, configureSchedule, reconcile, processStreak, completeWorkoutOn,
  noon, evening, sessionsByDate, cacheOf,
} from "./helpers";

// 2026-02-02 is a Monday; Mon 02 / Tue 03 / Thu 05 mirror the spec examples.
const MON = "2026-02-02";
const TUE = "2026-02-03";
const THU = "2026-02-05";
const NEXT_MON = "2026-02-09";

describe("ScheduleService: generation (spec H/AV)", () => {
  it("generates for one training day across a 35-day horizon, idempotently and deterministically", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    const r1 = reconcile(ctx, noon(MON));
    expect(r1.generated).toBe(5); // Mondays in [Feb02, Mar08]
    const after1 = ctx.repos.scheduledSessions.forProfile(ctx.profileId);
    expect(after1.every((s) => isoWeekdayOf(s.scheduledDate) === 1)).toBe(true);
    // Idempotent + deterministic: same window, nothing new.
    const r2 = reconcile(ctx, noon(MON));
    expect(r2.generated).toBe(0);
    expect(ctx.repos.scheduledSessions.countForProfile(ctx.profileId)).toBe(5);
  });

  it("generates for multiple days and for all seven days", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 3, 5] });
    reconcile(ctx, noon(MON));
    const dates = [...sessionsByDate(ctx).keys()].sort();
    expect(dates.every((d) => [1, 3, 5].includes(isoWeekdayOf(d)))).toBe(true);

    const ctx2 = setup();
    configureSchedule(ctx2, { weekdays: [1, 2, 3, 4, 5, 6, 7] });
    reconcile(ctx2, noon(MON));
    expect(ctx2.repos.scheduledSessions.countForProfile(ctx2.profileId)).toBe(35);
  });

  it("generates nothing for a zero-day schedule but a zero-obligation week is not perfect", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON);
    processStreak(ctx, noon(MON));
    const c = cacheOf(ctx);
    expect(c.currentStreak).toBe(0); // bonus workout: no scheduled streak
    expect(c.perfectWeeks).toBe(0);
  });

  it("does not pre-generate beyond the 35-day horizon", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    const dates = ctx.repos.scheduledSessions.forProfile(ctx.profileId).map((s) => s.scheduledDate).sort();
    expect(dates[0]).toBe(MON);
    expect(dates.length).toBe(5);
  });

  it("advances the rolling window as time passes without duplicating rows", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [4] });
    reconcile(ctx, noon(MON));
    reconcile(ctx, noon(THU));
    reconcile(ctx, noon(NEXT_MON));
    const dates = ctx.repos.scheduledSessions.forProfile(ctx.profileId).map((s) => s.scheduledDate);
    expect(new Set(dates).size).toBe(dates.length);
    // Thursdays from Feb 05 through Mar 12 inclusive of both windows.
    expect(dates.length).toBe(6);
  });
});

describe("ScheduleService: revisioning + history preservation (spec F/I/AP)", () => {
  it("bumps the revision only on meaningful changes and stamps sessions with it", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2, 4] });
    reconcile(ctx, noon(MON));
    const rev0 = ctx.repos.trainingSchedule.getForProfile(ctx.profileId)!.revision;
    expect(rev0).toBe(2); // revision 1 = the all-rest default; enabling days is meaningful
    // no-op update (identical configuration)
    ctx.services.schedule.updateWeeklySchedule(ctx.profileId, [
      { weekday: 1, enabled: true, routineId: null },
      { weekday: 2, enabled: true, routineId: null },
      { weekday: 3, enabled: false, routineId: null },
      { weekday: 4, enabled: true, routineId: null },
      { weekday: 5, enabled: false, routineId: null },
      { weekday: 6, enabled: false, routineId: null },
      { weekday: 7, enabled: false, routineId: null },
    ]);
    expect(ctx.repos.trainingSchedule.getForProfile(ctx.profileId)!.revision).toBe(2);
    // add Friday
    ctx.services.schedule.updateWeeklySchedule(ctx.profileId, [
      { weekday: 1, enabled: true, routineId: null },
      { weekday: 2, enabled: true, routineId: null },
      { weekday: 3, enabled: false, routineId: null },
      { weekday: 4, enabled: true, routineId: null },
      { weekday: 5, enabled: true, routineId: null },
      { weekday: 6, enabled: false, routineId: null },
      { weekday: 7, enabled: false, routineId: null },
    ]);
    expect(ctx.repos.trainingSchedule.getForProfile(ctx.profileId)!.revision).toBe(3);
    const sessions = ctx.repos.scheduledSessions.forProfile(ctx.profileId);
    expect(sessions.filter((s) => s.scheduledDate < NEXT_MON).every((s) => s.scheduleRevision === 2)).toBe(true);
    expect(sessions.filter((s) => isoWeekdayOf(s.scheduledDate) === 5 && s.scheduledDate >= NEXT_MON)
      .every((s) => s.scheduleRevision === 3)).toBe(true);
  });

  it("never rewrites historical sessions when the weekly schedule changes (spec AP)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2, 4] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON);
    processStreak(ctx, noon(MON)); // Monday completed
    const before = ctx.repos.scheduledSessions.forProfile(ctx.profileId)
      .filter((s) => s.scheduledDate <= MON);
    // 12-weeks-style change: now Mon/Wed/Fri
    ctx.services.schedule.updateWeeklySchedule(ctx.profileId, [
      { weekday: 1, enabled: true, routineId: null },
      { weekday: 2, enabled: false, routineId: null },
      { weekday: 3, enabled: true, routineId: null },
      { weekday: 4, enabled: false, routineId: null },
      { weekday: 5, enabled: true, routineId: null },
      { weekday: 6, enabled: false, routineId: null },
      { weekday: 7, enabled: false, routineId: null },
    ]);
    processStreak(ctx, noon(NEXT_MON));
    const after = ctx.repos.scheduledSessions.forProfile(ctx.profileId)
      .filter((s) => s.scheduledDate <= MON);
    expect(after).toEqual(before); // historical ledger untouched
    // The abandoned Tuesday obligation (still pending, this week) is NOT history:
    // the schedule changed before it resolved, so it was reconciled away.
    const tuesday = ctx.repos.scheduledSessions.forDate(ctx.profileId, TUE);
    expect(tuesday.every((s) => s.status !== "pending")).toBe(true);
  });

  it("reconciles today's pending obligation to a changed explicit schedule (spec I)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON)); // today Monday pending
    // Before the day resolves, the user changes the plan to Tuesday.
    ctx.services.schedule.updateWeeklySchedule(ctx.profileId, [
      { weekday: 1, enabled: false, routineId: null },
      { weekday: 2, enabled: true, routineId: null },
      { weekday: 3, enabled: false, routineId: null },
      { weekday: 4, enabled: false, routineId: null },
      { weekday: 5, enabled: false, routineId: null },
      { weekday: 6, enabled: false, routineId: null },
      { weekday: 7, enabled: false, routineId: null },
    ], { todayUtc: noon(MON) });
    reconcile(ctx, noon(MON));
    const monday = ctx.repos.scheduledSessions.forDate(ctx.profileId, MON);
    expect(monday.every((s) => s.status === "cancelled")).toBe(true);
    const tuesday = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, TUE);
    expect(tuesday?.status).toBe("pending");
  });
});

describe("ScheduleService: disable / enable (spec AH/AI)", () => {
  it("disabling cancels pending obligations without creating misses or erasing history", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2, 4] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON);
    processStreak(ctx, noon(MON));
    expect(cacheOf(ctx).currentStreak).toBe(1);
    const completedBefore = ctx.repos.scheduledSessions.forProfile(ctx.profileId)
      .filter((s) => s.status === "completed").length;
    ctx.services.schedule.setScheduleEnabled(ctx.profileId, false);
    processStreak(ctx, noon(MON));
    const sessions = ctx.repos.scheduledSessions.forProfile(ctx.profileId);
    expect(sessions.filter((s) => s.status === "completed").length).toBe(completedBefore);
    expect(sessions.every((s) => s.status !== "missed")).toBe(true);
    expect(sessions.every((s) => s.status !== "pending")).toBe(true);
    expect(cacheOf(ctx).currentStreak).toBe(1); // streak preserved by the toggle
    expect(cacheOf(ctx).bestStreak).toBe(1);
  });

  it("re-enabling regenerates future obligations from the current configuration", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    ctx.services.schedule.setScheduleEnabled(ctx.profileId, false);
    reconcile(ctx, noon(MON));
    expect(ctx.repos.scheduledSessions.pendingFrom(ctx.profileId, MON).length).toBe(0);
    ctx.services.schedule.setScheduleEnabled(ctx.profileId, true);
    reconcile(ctx, noon(MON));
    const pending = ctx.repos.scheduledSessions.pendingFrom(ctx.profileId, MON);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((s) => s.scheduledDate >= MON)).toBe(true);
  });
});

describe("Logical training day boundary (spec J/AO)", () => {
  it("03:59 belongs to the previous logical day, 04:00/04:01 to the current one", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON, { atUtc: TUE + "T03:59:00.000Z" }); // Tuesday 03:59 -> Monday
    processStreak(ctx, TUE + "T12:00:00.000Z");
    const monday = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON);
    expect(monday?.status).toBe("completed");
  });

  it("a workout at/after 04:00 stays on its own calendar day", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, TUE, { atUtc: TUE + "T04:00:00.000Z" });
    completeWorkoutOn(ctx, TUE, { atUtc: TUE + "T04:01:00.000Z" });
    processStreak(ctx, TUE + "T12:00:00.000Z");
    const tuesday = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, TUE);
    expect(tuesday?.status).toBe("completed"); // one obligation, first workout
    const monday = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON);
    expect(monday?.status).toBe("missed"); // Monday's window passed untrained
  });

  it("matches using the workout's own timezone offset (spec AM)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [7] }); // Sunday
    reconcile(ctx, noon("2026-02-08"), -300); // generate with New York offset
    // 2026-02-09T00:30Z = 2026-02-08T19:30 local (UTC-5) -> logical Sunday Feb 8.
    completeWorkoutOn(ctx, "2026-02-09", { atUtc: "2026-02-09T00:30:00.000Z", offset: -300 });
    processStreak(ctx, noon("2026-02-09"), -300);
    const sunday = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, "2026-02-08");
    expect(sunday?.status).toBe("completed");
  });

  it("calendar dates stay dates across a DST weekend: Monday remains Monday (spec AN)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2, 3, 4, 5, 6, 7] });
    reconcile(ctx, noon("2026-03-09")); // week after the US spring-forward (Mar 8)
    const week = ctx.repos.scheduledSessions.forProfile(ctx.profileId)
      .filter((s) => s.scheduledDate >= "2026-03-09" && s.scheduledDate <= "2026-03-15")
      .map((s) => s.scheduledDate).sort();
    expect(week.length).toBe(7);
    expect(isoWeekdayOf(week[0]!)).toBe(1);
    expect(isoWeekdayOf(week[6]!)).toBe(7);
  });
});

describe("Workout timing around the day boundary (spec AO)", () => {
  it("a late-night workout (before 04:00) satisfies the PREVIOUS day's obligation", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    // Monday 22:00 workout plus the same workout continued past midnight.
    completeWorkoutOn(ctx, MON, { atUtc: evening(MON) });
    processStreak(ctx, TUE + "T03:00:00.000Z");
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)?.status).toBe("completed");
    expect(cacheOf(ctx).currentStreak).toBe(1);
  });
});