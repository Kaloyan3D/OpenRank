/**
 * Notification payload + identity utilities (Phase 7, specs AG/H/AK/AW).
 *
 * Deep-link payloads carry STABLE IDENTIFIERS only (never display text as
 * identity). Incoming payloads are strictly validated before navigation -
 * malformed data falls back safely instead of throwing or mutating anything.
 *
 * Notification tap NEVER creates workouts: routing only ever opens existing
 * context (active workout / Home). Conflict-safe start remains behind the
 * explicit user CTA (spec AE/AF).
 */

import type { NotificationPayload } from "@openrank/domain";

/** Deterministic, dependency-free hash for payload drift detection (spec AK). */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function trainingDedupeKey(sessionId: string, kind: "training_primary" | "training_secondary"): string {
  return sessionId + ":" + kind;
}

export function restDedupeKey(workoutId: string): string {
  return "rest:" + workoutId;
}

const ISO_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Validate an incoming (OS-provided) notification payload. Returns null for
 * anything malformed - callers route to a safe fallback (spec AG).
 */
export function validateNotificationPayload(data: unknown): NotificationPayload | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.profileId !== "string" || !ISO_ID.test(d.profileId)) return null;
  if (d.type === "training_reminder") {
    if (typeof d.scheduledSessionId !== "string" || !ISO_ID.test(d.scheduledSessionId)) return null;
    return { type: "training_reminder", profileId: d.profileId, scheduledSessionId: d.scheduledSessionId };
  }
  if (d.type === "rest_timer") {
    if (typeof d.workoutId !== "string" || !ISO_ID.test(d.workoutId)) return null;
    return { type: "rest_timer", profileId: d.profileId, workoutId: d.workoutId };
  }
  return null;
}

export interface NotificationRouteInput {
  payload: NotificationPayload | null;
  /** The profile's current active workout id, if any (Phase 4 conflict state). */
  activeWorkoutId: string | null;
  /** True when the referenced scheduled session still exists (training taps). */
  scheduledSessionExists?: boolean | undefined;
}

/**
 * Routing decision for a notification tap (spec AE/AF/AW).
 * - training reminder -> Home (the planned-workout CTA lives there; the
 *   conflict-safe start logic is shared).
 * - rest timer -> the active workout when one exists, otherwise Home.
 * - malformed / missing references -> Home fallback. NEVER creates data.
 */
export function resolveNotificationRoute(input: NotificationRouteInput): string | null {
  const { payload } = input;
  if (!payload) return "/(tabs)";
  if (payload.type === "training_reminder") {
    if (input.scheduledSessionExists === false) return "/(tabs)";
    return "/(tabs)";
  }
  // rest_timer
  if (input.activeWorkoutId) return "/workout/" + input.activeWorkoutId;
  return "/(tabs)";
}
