/**
 * Deep-link payload validation + routing (specs AE/AF/AG/AW): stable ids
 * only, strict validation, safe fallbacks. A tap NEVER creates canonical
 * data; starts remain behind the explicit conflict-safe CTA.
 */

import { describe, expect, it } from "vitest";
import type { NotificationPayload } from "@openrank/domain";
import { resolveNotificationRoute, validateNotificationPayload } from "../services/notifications/payload";

const VALID_TRAINING: NotificationPayload = { type: "training_reminder", profileId: "p1", scheduledSessionId: "s1" };
const VALID_REST: NotificationPayload = { type: "rest_timer", profileId: "p1", workoutId: "w1" };

describe("payload validation (spec AG)", () => {
  it("accepts valid payloads", () => {
    expect(validateNotificationPayload(VALID_TRAINING)).toEqual(VALID_TRAINING);
    expect(validateNotificationPayload(VALID_REST)).toEqual(VALID_REST);
  });

  it("rejects malformed payloads", () => {
    expect(validateNotificationPayload(null)).toBeNull();
    expect(validateNotificationPayload(undefined)).toBeNull();
    expect(validateNotificationPayload("reminder")).toBeNull();
    expect(validateNotificationPayload(42)).toBeNull();
    expect(validateNotificationPayload({})).toBeNull();
    expect(validateNotificationPayload({ type: "other", profileId: "p1" })).toBeNull();
    expect(validateNotificationPayload({ type: "training_reminder" })).toBeNull();
    expect(validateNotificationPayload({ type: "training_reminder", profileId: "p1" })).toBeNull();
    expect(validateNotificationPayload({ type: "training_reminder", profileId: "", scheduledSessionId: "s1" })).toBeNull();
    expect(validateNotificationPayload({ type: "training_reminder", profileId: "p1", scheduledSessionId: "" })).toBeNull();
    expect(validateNotificationPayload({ type: "rest_timer", profileId: "p1" })).toBeNull();
    expect(validateNotificationPayload({ type: "rest_timer", profileId: "p1", scheduledSessionId: "s1" })).toBeNull();
    expect(validateNotificationPayload({ type: "training_reminder", profileId: 5, scheduledSessionId: "s1" })).toBeNull();
    expect(validateNotificationPayload({ type: "training_reminder", profileId: "p1", scheduledSessionId: "s1", extra: true })).toEqual(VALID_TRAINING);
  });
});

describe("tap routing (spec AE/AF/AW)", () => {
  it("training reminder -> Home (planned-workout CTA; no data mutation)", () => {
    expect(resolveNotificationRoute({ payload: VALID_TRAINING, activeWorkoutId: null })).toBe("/(tabs)");
    expect(resolveNotificationRoute({ payload: VALID_TRAINING, activeWorkoutId: "w9" })).toBe("/(tabs)");
  });

  it("training reminder with vanished session -> safe Home fallback", () => {
    expect(resolveNotificationRoute({ payload: VALID_TRAINING, activeWorkoutId: null, scheduledSessionExists: false })).toBe("/(tabs)");
  });

  it("rest timer -> active workout when one exists", () => {
    expect(resolveNotificationRoute({ payload: VALID_REST, activeWorkoutId: "w1" })).toBe("/workout/w1");
  });

  it("rest timer with disappeared workout -> Home, never a crash (spec AF)", () => {
    expect(resolveNotificationRoute({ payload: VALID_REST, activeWorkoutId: null })).toBe("/(tabs)");
  });

  it("malformed payload -> Home fallback (spec AG)", () => {
    expect(resolveNotificationRoute({ payload: null, activeWorkoutId: null })).toBe("/(tabs)");
  });

  it("routing never returns a workout-creation route", () => {
    for (const payload of [VALID_TRAINING, VALID_REST, null]) {
      const route = resolveNotificationRoute({ payload, activeWorkoutId: null });
      expect(route === "/(tabs)" || route === null || route.startsWith("/workout/")).toBe(true);
    }
  });
});