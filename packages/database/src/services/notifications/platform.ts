/**
 * Notification platform abstraction (Phase 7, spec I).
 *
 * NotificationService / reconciler logic operates ONLY against this
 * interface - never against expo-notifications directly. Deterministic
 * tests use an in-memory fake; the mobile app injects an Expo-backed
 * implementation; non-mobile/default environments get the Null platform
 * (permission always undetermined, scheduling is a no-op), which keeps the
 * whole feature safely disabled without a native module.
 */

import type { NotificationPayload } from "@openrank/domain";
import type { NotificationPermissionStatus } from "@openrank/domain";

export type NotificationChannelId = "training" | "rest";

export interface PlatformNotificationRequest {
  /** Stable dedupe identity (spec H) - the platform adapter may reuse it. */
  dedupeKey: string;
  title: string;
  body: string;
  /** Absolute ISO instant the OS should present the notification. */
  scheduledFor: string;
  /** Validated deep-link payload (spec AG). */
  payload: NotificationPayload;
  channelId: NotificationChannelId;
}

export interface NotificationPlatform {
  getPermissionStatus(): Promise<NotificationPermissionStatus>;
  requestPermission(): Promise<NotificationPermissionStatus>;
  /** Schedule ONE notification; returns the platform notification id. */
  schedule(request: PlatformNotificationRequest): Promise<string>;
  cancel(platformNotificationId: string): Promise<void>;
  /** Platform ids of ALL OpenRank-scheduled (not yet delivered) notifications. */
  getScheduled(): Promise<string[]>;
}

/** Default platform: everything off, permission undetermined, zero side effects. */
export class NullNotificationPlatform implements NotificationPlatform {
  async getPermissionStatus(): Promise<NotificationPermissionStatus> {
    return "undetermined";
  }

  async requestPermission(): Promise<NotificationPermissionStatus> {
    return "undetermined";
  }

  async schedule(): Promise<string> {
    return "null:noop";
  }

  async cancel(): Promise<void> {
    /* no-op */
  }

  async getScheduled(): Promise<string[]> {
    return [];
  }
}
