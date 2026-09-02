import { describe, expect, it } from "vitest";
import { computeStreakState } from "../services";
import type { ScheduledSession } from "@openrank/domain";
import {
  setup, configureSchedule, reconcile, processStreak, completeWorkoutOn, noon, cacheOf,
} from "./helpers";

const MON = "2026-02-02";
const TUE = "2026-02-03";
const THU = "2026-02-05";
const FRI = "2026-02-06";
const SAT = "2026-02-07";
const SUN = "2026-02-08";

let idCounter = 0;
function session(partial: Partial<ScheduledSession> & { scheduledDate: string }): ScheduledSession {
  idCounter += 1;
  const base: ScheduledSession = {
    id: "pw-" + String(idCounter).padStart(4, "0"),
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
      pendingUntil: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  };
  return { ...base, ...partial, originalDate: partial.originalDate ?? base.originalDate, scheduledDate: partial.scheduledDate };
}

describe("Perfect weeks (spec Z/AA/AX)", () => {
  it("all obligations completed -> perfect", () => {
    const state = computeStreakState([
      session({ scheduledDate: MON, status: "completed", workoutId: "w1" }),
      session({ scheduledDate: TUE, status: "completed", workoutId: "w2" }),
      session({ scheduledDate: THU, status: "completed", workoutId: "w3" }),
    ], "2026-02-12T12:00:00.000Z");
    expect(state.perfectWeeks).toBe(1);
  });

  it("one miss -> not perfect; paused obligation -> still perfect", () => {
    const missed = computeStreakState([
      session({ scheduledDate: MON, status: "completed", workoutId: "w1" }),
      session({ scheduledDate: TUE, status: "missed" }),
      session({ scheduledDate: THU, status: "completed", workoutId: "w2" }),
    ], "2026-02-12T12:00:00.000Z");
    expect(missed.perfectWeeks).toBe(0);

    const paused = computeStreakState([
      session({ scheduledDate: MON, status: "completed", workoutId: "w1" }),
      session({ scheduledDate: TUE, status: "paused" }),
      session({ scheduledDate: THU, status: "completed", workoutId: "w2" }),
    ], "2026-02-12T12:00:00.000Z");
    expect(paused.perfectWeeks).toBe(1);
  });

  it("zero-obligation weeks do not count", () => {
    // One perfect week; the following weeks have no obligations at all and
    // must not be counted as perfect.
    const state = computeStreakState([
      session({ scheduledDate: MON, status: "completed", workoutId: "w1" }),
      session({ scheduledDate: TUE, status: "completed", workoutId: "w2" }),
    ], "2026-02-12T12:00:00.000Z");
    expect(state.perfectWeeks).toBe(1);
  });

  it("a week with only bonus workouts (no scheduled rows) is not perfect", () => {
    const state = computeStreakState([], "2026-02-12T12:00:00.000Z");
    expect(state.perfectWeeks).toBe(0);
  });

  it("partial current week: pending obligations keep the week non-final (spec AA)", () => {
    const state = computeStreakState([
      session({ scheduledDate: MON, status: "completed", workoutId: "w1" }),
      session({ scheduledDate: THU, status: "pending" }),
    ], "2026-02-12T12:00:00.000Z");
    expect(state.perfectWeeks).toBe(0);
    expect(state.currentStreak).toBe(1);
  });

  it("weeks crossing a month boundary and the ISO year boundary are keyed correctly", () => {
    // ISO week 2026-W09 spans Mar 02 (Mon) .. Mar 08 (Sun) - clean.
    // ISO week 2026-W01 of 2027 starts Monday 2026-12-29 (contains Jan 1 2027).
    const state = computeStreakState([
      session({ scheduledDate: "2026-02-27", status: "completed", workoutId: "a" }), // Fri, W09? Feb27 is week 9
      session({ scheduledDate: "2026-03-02", status: "completed", workoutId: "b" }), // Mon Mar 2
      session({ scheduledDate: "2026-12-31", status: "completed", workoutId: "c" }), // Thu, W53 of 2026
      session({ scheduledDate: "2027-01-01", status: "completed", workoutId: "d" }), // Fri, W53 of 2026
    ], "2027-01-04T12:00:00.000Z");
    // Feb27 belongs to its own week with 1 obligation -> perfect; Mar02 its own week -> perfect;
    // Dec31+Jan01 share ISO week (2026-W53) -> perfect. 3 perfect weeks.
    expect(state.perfectWeeks).toBe(3);
  });

  it("rescheduled obligation counts in the TARGET week position for perfection", () => {
    // Thursday moved within the same week to Saturday; Saturday completed.
    const state = computeStreakState([
      session({ scheduledDate: MON, status: "completed", workoutId: "w1" }),
      session({ scheduledDate: THU, status: "rescheduled" }),
      session({ scheduledDate: SAT, status: "completed", workoutId: "w2", rescheduledFromDate: THU }),
    ], "2026-02-12T12:00:00.000Z");
    expect(state.perfectWeeks).toBe(1);
  });

  it("end-to-end: a full week of completions awards exactly one perfect week", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2, 4] });
    for (const d of [MON, TUE, THU]) {
      reconcile(ctx, noon(d));
      completeWorkoutOn(ctx, d);
      processStreak(ctx, noon(d));
    }
    // Sunday after: week final (all obligations resolved).
    reconcile(ctx, noon(SUN));
    processStreak(ctx, noon(SUN));
    expect(cacheOf(ctx).perfectWeeks).toBe(1);
    expect(cacheOf(ctx).currentStreak).toBe(3);
  });

  it("end-to-end: a miss in the week removes perfection (0 perfect weeks)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 2, 4] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON);
    processStreak(ctx, noon(MON));
    // Tuesday passes untrained.
    reconcile(ctx, noon(THU));
    processStreak(ctx, noon(THU));
    completeWorkoutOn(ctx, THU);
    processStreak(ctx, noon(THU));
    expect(cacheOf(ctx).perfectWeeks).toBe(0);
    expect(cacheOf(ctx).currentStreak).toBe(1);
  });

  it("end-to-end: Friday+Saturday schedule across the week boundary finalizes Monday", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [5, 6] });
    reconcile(ctx, noon(FRI));
    completeWorkoutOn(ctx, FRI);
    processStreak(ctx, noon(FRI));
    completeWorkoutOn(ctx, SAT);
    processStreak(ctx, noon(SAT));
    reconcile(ctx, noon(SUN));
    processStreak(ctx, noon(SUN));
    expect(cacheOf(ctx).perfectWeeks).toBe(1);
  });
});