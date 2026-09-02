/**
 * Expo-backed NotificationPlatform (Phase 7, spec I/B).
 *
 * The ONLY place in the app that touches expo-notifications. Entirely local:
 * one-off scheduled notifications owned by the OS scheduler; no push, no
 * remote messaging, no server. Android channels are created lazily (spec AD):
 * two channels total - "Training Reminders" and "Rest Timers".
 */

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { NotificationPermissionStatus } from "@openrank/domain";
import type {
  NotificationChannelId,
  NotificationPlatform,
  PlatformNotificationRequest,
} from "@openrank/database";

function toExpoStatus(status: Notifications.PermissionStatus): NotificationPermissionStatus {
  return status === Notifications.PermissionStatus.GRANTED
    ? "granted"
    : status === Notifications.PermissionStatus.DENIED
      ? "denied"
      : "undetermined";
}

const CHANNEL_NAMES: Record<NotificationChannelId, string> = {
  training: "Training Reminders",
  rest: "Rest Timers",
};

export class ExpoNotificationPlatform implements NotificationPlatform {
  private channelsReady = false;

  private async ensureChannels(): Promise<void> {
    if (this.channelsReady || Platform.OS !== "android") return;
    try {
      for (const id of Object.keys(CHANNEL_NAMES) as NotificationChannelId[]) {
        await Notifications.setNotificationChannelAsync(id, {
          name: CHANNEL_NAMES[id],
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 180, 120, 180],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }
      this.channelsReady = true;
    } catch {
      /* channel setup is best-effort; scheduling still works on iOS */
    }
  }

  async getPermissionStatus(): Promise<NotificationPermissionStatus> {
    const settings = await Notifications.getPermissionsAsync();
    return toExpoStatus(settings.status);
  }

  async requestPermission(): Promise<NotificationPermissionStatus> {
    // Physical device required for real permission semantics (spec AY).
    if (!Device.isDevice) return "undetermined";
    const settings = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: true },
    });
    return toExpoStatus(settings.status);
  }

  async schedule(request: PlatformNotificationRequest): Promise<string> {
    await this.ensureChannels();
    const trigger: Notifications.DateTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(request.scheduledFor),
    };
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: request.title,
        body: request.body,
        data: { ...request.payload },
        sound: "default",
      },
      trigger,
      ...(Platform.OS === "android" ? { channelId: request.channelId } : {}),
    });
    return id;
  }

  async cancel(platformNotificationId: string): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(platformNotificationId);
    } catch {
      /* already gone - drift repair continues */
    }
  }

  async getScheduled(): Promise<string[]> {
    try {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      return all.map((n) => n.identifier);
    } catch {
      return [];
    }
  }
}

/** True on real hardware with a notification-capable environment (AY). */
export function notificationEnvironmentReady(): boolean {
  return Device.isDevice && Constants.appOwnership !== "expo";
}
