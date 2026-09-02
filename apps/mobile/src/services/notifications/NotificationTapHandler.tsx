/**
 * Notification tap routing (Phase 7, specs AE/AF/AG/AW).
 *
 * - Validates the OS-provided payload strictly before navigating.
 * - Training reminder -> Home (the planned-workout CTA + conflict-safe start
 *   live there). NEVER creates a workout from a tap.
 * - Rest timer -> the active workout when one still exists, otherwise Home.
 * - Malformed payloads fall back to Home safely.
 */

import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { resolveNotificationRoute, validateNotificationPayload } from "@openrank/database";
import { useRepos } from "../../db/DatabaseProvider";

// OS should not surface its own banners while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: true,
  }),
});

export function NotificationTapHandler(props: { children: ReactNode }) {
  const router = useRouter();
  const repos = useRepos();

  useEffect(() => {
    const routeFromResponse = (response: Notifications.NotificationResponse): void => {
      const profile = repos.profile.getDefault();
      const data = response.notification.request.content.data;
      const payload = validateNotificationPayload(data);
      const active = profile ? repos.workout.getActive(profile.id) : null;
      const activeWorkoutId = active ? active.workout.id : null;
      const sessionId = payload && payload.type === "training_reminder" ? payload.scheduledSessionId : undefined;
      const route = resolveNotificationRoute({
        payload,
        activeWorkoutId,
        scheduledSessionExists: sessionId ? repos.scheduledSessions.getById(sessionId) != null : undefined,
      });
      if (route) router.push(route);
    };

    // Cold start (app launched by the tap).
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) routeFromResponse(response);
    });
    // Warm taps.
    const sub = Notifications.addNotificationResponseReceivedListener(routeFromResponse);
    return () => sub.remove();
  }, [router, repos]);

  return props.children;
}