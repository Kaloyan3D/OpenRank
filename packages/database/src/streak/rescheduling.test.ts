import { describe, expect, it } from "vitest";
import { RescheduleError } from "../services";
import {
  setup, configureSchedule, reconcile, processStreak, completeWorkoutOn, noon, sessionsByDate, cacheOf,
} from "./helpers";

const MON = "2026-02-02";
const TUE = "2026-02-03";
const WED = "2026-02-04";
const THU = "2026-02-05";
const NEXT_MON = "2026-02-09";

describe("Rescheduling (spec U/V/AY)", () => {
  it("Monday -> Wednesday keeps ONE obligation; completing it increments once", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    const target = ctx.services.schedule.rescheduleSession(
      ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!.id, WED, { todayUtc: noon(MON) },
    );
    expect(target.scheduledDate).toBe(WED);
    expect(target.rescheduledFromDate).toBe(MON);
    expect(target.originalDate).toBe(MON); // provenance keeps the very original
    const monday = sessionsByDate(ctx).get(MON)!;
    expect(monday.filter((s) => s.status === "rescheduled").length).toBe(1);
    expect(monday.filter((s) => s.status === "pending").length).toBe(0);
    completeWorkoutOn(ctx, WED);
    processStreak(ctx, noon(WED));
    expect(cacheOf(ctx).currentStreak).toBe(1);
    const wednesday = sessionsByDate(ctx).get(WED)!;
    expect(wednesday.filter((s) => s.status === "completed").length).toBe(1);
  });

  it("moving the target again is allowed and keeps one obligation (chain)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    const first = ctx.services.schedule.rescheduleSession(
      ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!.id, WED, { todayUtc: noon(MON) },
    );
    const second = ctx.services.schedule.rescheduleSession(first.id, THU, { todayUtc: noon(MON) });
    expect(second.scheduledDate).toBe(THU);
    expect(second.originalDate).toBe(MON);
    expect(second.rescheduledFromDate).toBe(WED);
    const wednesday = sessionsByDate(ctx).get(WED)!;
    expect(wednesday.every((s) => s.status === "rescheduled" || s.status === "cancelled")).toBe(true);
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, THU)?.status).toBe("pending");
  });

  it("rejects a target date that already has an active obligation (no silent merge)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1, 4] });
    reconcile(ctx, noon(MON));
    expect(() =>
      ctx.services.schedule.rescheduleSession(
        ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!.id, THU, { todayUtc: noon(MON) },
      ),
    ).toThrow(RescheduleError);
    // nothing changed
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)?.status).toBe("pending");
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, THU)?.status).toBe("pending");
  });

  it("rejects moves outside the same ISO week", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    expect(() =>
      ctx.services.schedule.rescheduleSession(
        ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!.id, NEXT_MON, { todayUtc: noon(MON) },
      ),
    ).toThrow(RescheduleError);
  });

  it("rejects moving a completed session", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON);
    processStreak(ctx, noon(MON));
    const completed = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!;
    expect(completed.status).toBe("completed");
    expect(() =>
      ctx.services.schedule.rescheduleSession(completed.id, WED, { todayUtc: noon(MON) }),
    ).toThrow(RescheduleError);
  });

  it("rejects moving a missed session (no retroactive repair)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    processStreak(ctx, noon(TUE)); // Monday expired -> missed
    const missed = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!;
    expect(missed.status).toBe("missed");
    expect(() =>
      ctx.services.schedule.rescheduleSession(missed.id, WED, { todayUtc: noon(TUE) }),
    ).toThrow(RescheduleError);
    expect(missed.status).toBe("missed");
  });

  it("rejects a repeated reschedule of the same (already moved) session", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    const source = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!;
    ctx.services.schedule.rescheduleSession(source.id, WED, { todayUtc: noon(MON) });
    expect(() =>
      ctx.services.schedule.rescheduleSession(source.id, THU, { todayUtc: noon(MON) }),
    ).toThrow(RescheduleError);
  });

  it("rejects rescheduling into the past", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [3] }); // Wednesday
    reconcile(ctx, noon(MON)); // Wednesday generated, still pending on Tuesday
    expect(() =>
      ctx.services.schedule.rescheduleSession(
        ctx.repos.scheduledSessions.activeForDate(ctx.profileId, WED)!.id, MON, { todayUtc: noon(TUE) },
      ),
    ).toThrow(RescheduleError);
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, WED)?.status).toBe("pending");
  });

  it("rescheduling to TODAY (a current session) is allowed", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [4] });
    reconcile(ctx, noon(MON));
    const target = ctx.services.schedule.rescheduleSession(
      ctx.repos.scheduledSessions.activeForDate(ctx.profileId, THU)!.id, MON, { todayUtc: noon(MON) },
    );
    expect(target.scheduledDate).toBe(MON);
  });

  it("backward moves within the same week are allowed", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [4] });
    reconcile(ctx, noon(MON));
    const target = ctx.services.schedule.rescheduleSession(
      ctx.repos.scheduledSessions.activeForDate(ctx.profileId, THU)!.id, TUE, { todayUtc: noon(MON) },
    );
    expect(target.scheduledDate).toBe(TUE);
  });
});