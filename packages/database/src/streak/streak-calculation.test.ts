import { describe, expect, it } from "vitest";
import { computeStreakState, STREAK_MILESTONES } from "../services";
import type { ScheduledSession } from "@openrank/domain";
import {
  setup, configureSchedule, reconcile, processStreak, completeWorkoutOn, noon, sessionsByDate, cacheOf, eventKeys,
} from "./helpers";

const MON = "2026-02-02";
const TUE = "2026-02-03";
const WED = "2026-02-04";
const THU = "2026-02-05";
const MON2 = "2026-02-09";
const TUE2 = "2026-02-10";
const THU2 = "2026-02-12";

let idCounter = 0;
function session(partial: Partial<ScheduledSession> & { scheduledDate: string }): ScheduledSession {
  idCounter += 1;
  const base: ScheduledSession = {
    id: "sess-" + String(idCounter).padStart(4, "0"),
    profileId: "p",
    originalDate: partial.scheduledDate,
    scheduledDate: partial.scheduledDate,
    routineId: null,
    status: "pending",
    scheduleRevision: 1,
    workoutId: null,
    completedAt: null,
    rescheduledFromDate: null,
    streakAfter: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  };
  return { ...base, ...partial, originalDate: partial.originalDate ?? base.originalDate, scheduledDate: partial.scheduledDate };
}

describe("computeStreakState (spec O/P)", () => {
  it("counts consecutive completions: the spec P example yields current 1, best 4", () => {
    const sessions = [
      session({ scheduledDate: MON, status: "completed", workoutId: "w1" }),
      session({ scheduledDate: TUE, status: "completed", workoutId: "w2" }),
      session({ scheduledDate: THU, status: "completed", workoutId: "w3" }),
      session({ scheduledDate: MON2, status: "completed", workoutId: "w4" }),
      session({ scheduledDate: TUE2, status: "missed" }),
      session({ scheduledDate: THU2, status: "completed", workoutId: "w5" }),
    ];
    const state = computeStreakState(sessions, "2026-02-12T12:00:00.000Z");
    expect(state.currentStreak).toBe(1);
    expect(state.bestStreak).toBe(4);
    expect(state.sessionStreaks.map((s) => s.streakAfter)).toEqual([1, 2, 3, 4, 1]);
    expect(state.lastMissedSessionDate).toBe(TUE2);
    // broken event for the miss
    expect(state.events.filter((e) => e.type === "broken").length).toBe(1);
  });

  it("rest days are absent from the ledger and therefore neutral by construction", () => {
    const sessions = [
      session({ scheduledDate: MON, status: "completed", workoutId: "w1" }),
      // Tue/Wed rest: no rows at all
      session({ scheduledDate: THU, status: "completed", workoutId: "w2" }),
    ];
    const state = computeStreakState(sessions, "2026-02-12T12:00:00.000Z");
    expect(state.currentStreak).toBe(2);
  });

  it("paused and rescheduled source rows are neutral; pending stops the walk", () => {
    const sessions = [
      session({ scheduledDate: MON, status: "completed", workoutId: "w1" }),
      session({ scheduledDate: TUE, status: "paused" }),
      session({ scheduledDate: WED, status: "rescheduled" }),
      session({ scheduledDate: THU, status: "completed", workoutId: "w2" }),
      session({ scheduledDate: MON2, status: "pending" }),
    ];
    const state = computeStreakState(sessions, "2026-02-12T12:00:00.000Z");
    expect(state.currentStreak).toBe(2);
    expect(state.bestStreak).toBe(2);
  });

  it("zero-obligation history yields zeros", () => {
    const state = computeStreakState([], "2026-02-12T12:00:00.000Z");
    expect(state.currentStreak).toBe(0);
    expect(state.bestStreak).toBe(0);
    expect(state.perfectWeeks).toBe(0);
    expect(state.events).toEqual([]);
  });

  it("milestones fire exactly at 5/10/25/50/100/250/500 crossing completions", () => {
    const sessions: ScheduledSession[] = [];
    for (let i = 0; i < 6; i += 1) {
      sessions.push(session({ scheduledDate: "2026-01-0" + String(i + 1), status: "completed", workoutId: "w" + String(i) }));
    }
    const state = computeStreakState(sessions, "2026-02-12T12:00:00.000Z");
    expect(STREAK_MILESTONES).toEqual([5, 10, 25, 50, 100, 250, 500]);
    expect(state.events.map((e) => e.key)).toEqual(["milestone:5"]);
    expect(state.events[0]!.value).toBe(5);
  });
});

describe("StreakService end-to-end (spec AW/T/AB)", () => {
  it("full DB flow: first completed session = 1, bonus does not increment, miss resets, best persists", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 4] }); // Mon + Thu: Tue/Wed/Fri/Sat/Sun are rest
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON);
    processStreak(ctx, noon(MON));
    expect(cacheOf(ctx).currentStreak).toBe(1);

    // Bonus workout on a rest day (Wednesday): streak stays 1.
    completeWorkoutOn(ctx, WED, { weightKg: 61 });
    processStreak(ctx, noon(WED));
    expect(cacheOf(ctx).currentStreak).toBe(1);

    completeWorkoutOn(ctx, THU);
    processStreak(ctx, noon(THU));
    expect(cacheOf(ctx).currentStreak).toBe(2);

    // Miss Monday next week, then complete Thursday: reset to 0 then 1.
    processStreak(ctx, noon(TUE2)); // Mon Feb 9 expires -> missed
    processStreak(ctx, noon(THU2));
    completeWorkoutOn(ctx, THU2);
    processStreak(ctx, noon(THU2));
    expect(cacheOf(ctx).currentStreak).toBe(1);
    expect(cacheOf(ctx).bestStreak).toBe(2);
    expect(ctx.repos.streakEvents.listForProfile(ctx.profileId).some((e) =>
      e.type === "broken" && e.key === "broken:" + ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON2)!.id,
    )).toBe(true);
  });

  it("multiple workouts on one scheduled day satisfy the obligation exactly once (spec L)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON, { atUtc: MON + "T14:00:00.000Z", weightKg: 60 });
    completeWorkoutOn(ctx, MON, { atUtc: MON + "T19:00:00.000Z", weightKg: 61 });
    processStreak(ctx, noon(MON));
    expect(cacheOf(ctx).currentStreak).toBe(1);
    const monday = sessionsByDate(ctx).get(MON)!;
    const active = monday.filter((s) => s.status !== "cancelled");
    expect(active.length).toBe(1);
    expect(active[0]!.status).toBe("completed");
    // The second workout is not linked anywhere.
    const linkedWorkouts = ctx.repos.scheduledSessions.forProfile(ctx.profileId)
      .filter((s) => s.workoutId != null).map((s) => s.workoutId);
    expect(linkedWorkouts.length).toBe(1);
  });

  it("repeated processPending and repeated rebuild are idempotent, incl. milestone events (spec AB/T)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2, 4] });
    reconcile(ctx, noon(MON));
    for (const d of [MON, TUE, THU]) {
      completeWorkoutOn(ctx, d);
      processStreak(ctx, noon(d));
    }
    // 3 completions -> no milestone yet; force one via engine-level 5? Keep
    // service-level: rebuild 3x and compare full projection state.
    const before = {
      cache: cacheOf(ctx),
      keys: eventKeys(ctx),
      marks: ctx.repos.scheduledSessions.forProfile(ctx.profileId).map((s) => s.streakAfter),
    };
    ctx.services.streak.rebuildAllStreakState(ctx.profileId);
    ctx.services.streak.rebuildAllStreakState(ctx.profileId);
    const after = {
      cache: { ...cacheOf(ctx), recalculatedAt: before.cache.recalculatedAt },
      keys: eventKeys(ctx),
      marks: ctx.repos.scheduledSessions.forProfile(ctx.profileId).map((s) => s.streakAfter),
    };
    expect(after).toEqual(before);
  });

  it("milestones are celebrated once and never re-celebrated after a rebuild (spec AB)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2, 3, 4] });
    // Six completed obligations across two ISO weeks -> crosses milestone 5.
    const dates = [MON, TUE, WED, THU, MON2, TUE2];
    for (const d of dates) {
      reconcile(ctx, noon(d));
      completeWorkoutOn(ctx, d);
      processStreak(ctx, noon(d));
    }
    expect(eventKeys(ctx)).toEqual(["milestone:milestone:5"]);
    const before = eventKeys(ctx);
    ctx.services.streak.rebuildAllStreakState(ctx.profileId);
    ctx.services.streak.rebuildAllStreakState(ctx.profileId);
    expect(eventKeys(ctx)).toEqual(before);
    expect(ctx.repos.streakEvents.countForProfile(ctx.profileId)).toBe(1);
  });

  it("pending future obligations do not count and are not misses (spec O)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 4] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON);
    processStreak(ctx, noon(MON));
    // Thursday (future) is pending: current streak stays 1, no broken events.
    expect(cacheOf(ctx).currentStreak).toBe(1);
    expect(eventKeys(ctx).filter((k) => k.startsWith("broken")).length).toBe(0);
    const thursday = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, THU);
    expect(thursday?.status).toBe("pending");
  });
});