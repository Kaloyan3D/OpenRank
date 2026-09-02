import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { NotificationPermissionStatus, ScheduleWeekday } from "@openrank/domain";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { useCanonicalRevision } from "../local-data/useCanonicalRevision";
import { colors } from "../design/colors";
import { radius } from "../design/radii";
import { space } from "../design/spacing";
import { type } from "../design/typography";

/**
 * Notification settings (Phase 7, specs V/X/AZ). Everything is opt-in and
 * conservative: reminders OFF until the user asks for them, permission is
 * requested only after the pre-permission explainer, and denying changes
 * nothing about training functionality.
 */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const REMINDER_CHOICES = [480, 660, 1020, 1110, 1140]; // 08:00, 11:00, 17:00, 18:30, 19:00
const DELAY_CHOICES = [30, 60, 120, 150, 240]; // minutes

function minutesLabel(minutes: number | null): string {
  if (minutes == null) return "off";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function delayLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (h > 0 ? h + "h " : "") + (m > 0 ? m + "m" : h > 0 ? "" : m + "m");
}

export default function NotificationsScreen() {
  const repos = useRepos();
  const services = useServices();
  // Canonical invalidation (Phase 8.2): preference writes commit -> the
  // revision advances -> this screen re-renders with persisted preferences.
  // "permission" and "explainerDismissed" are transient UI state (OS status
  // / local dismissal of the explainer), never canonical data.
  useCanonicalRevision();
  const [permission, setPermission] = useState<NotificationPermissionStatus>("undetermined");
  const [explainerDismissed, setExplainerDismissed] = useState(false);

  const profile = repos.profile.getDefault();

  useEffect(() => {
    if (!profile) return;
    void services.notifications.refreshPermissionStatus(profile.id).then((status) => setPermission(status));
  }, [profile, services]);

  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Internal state error - the local profile is missing. Restart the app to recover.</Text>
      </View>
    );
  }

  const prefs = services.notifications.getPreferences(profile.id);
  const { days } = services.schedule.getSchedule(profile.id);
  const enabledDays = days.filter((d) => d.enabled);

  const reconcile = () => {
    void services.notifications
      .reconcileNotifications(profile.id, {
        todayUtc: new Date().toISOString(),
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      })
      .then(() => setPermission(prefs.permissionStatus))
      .catch(() => {});
  };

  const enableReminders = async () => {
    // Pre-permission explainer (spec V) is THIS screen's flow: the user has
    // read the context and pressed "Enable reminders" - only now ask the OS.
    const status = await services.notifications.requestPermission(profile.id);
    setPermission(status);
    if (status === "granted") {
      services.notifications.updatePreferences(profile.id, { trainingRemindersEnabled: true });
      if (enabledDays.every((d) => d.reminderMinutesAfterMidnight == null)) {
        services.notifications.setReminderTimeForEnabledDays(profile.id, 1020); // 17:00 default
      }
      reconcile();
    }
  };

  const openSystemSettings = () => {
    void import("expo-linking").then((Linking) => Linking.openSettings());
  };

  const setDayTime = (weekday: ScheduleWeekday, minutes: number | null) => {
    services.notifications.setDayReminderTime(profile.id, weekday, minutes);
    reconcile();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Notifications</Text>
      <Text style={styles.muted}>
        OpenRank can remind you only on the training days you choose. Rest
        days never get reminders. Reminders are generated from your planned
        sessions - reschedules, pauses and completed workouts are always
        respected.
      </Text>

      {permission === "granted" ? (
        <Text style={styles.statusOk}>{"\u2713 Notifications are enabled"}</Text>
      ) : permission === "denied" ? (
        <View>
          <Text style={styles.statusOff}>Notifications are off</Text>
          <Text style={styles.muted}>
            OpenRank remains fully usable without notifications.
          </Text>
          <Pressable style={styles.button} onPress={openSystemSettings}>
            <Text style={styles.buttonText}>Open system settings</Text>
          </Pressable>
        </View>
      ) : explainerDismissed ? null : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Never miss a planned workout</Text>
          <Text style={styles.muted}>
            OpenRank can remind you only on the training days you choose.
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => void enableReminders()}>
            <Text style={styles.primaryButtonText}>Enable reminders</Text>
          </Pressable>
          <Pressable onPress={() => setExplainerDismissed(true)}>
            <Text style={styles.linkText}>Not now</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.switchRow}>
        <Text style={styles.body}>Training reminders</Text>
        <Switch
          value={prefs.trainingRemindersEnabled}
          disabled={permission !== "granted"}
          onValueChange={(v) => {
            services.notifications.updatePreferences(profile.id, { trainingRemindersEnabled: v });
            reconcile();
          }}
        />
      </View>

      <Text style={styles.section}>Reminder style</Text>
      <View style={styles.row}>
        {(["gentle", "normal", "competitive"] as const).map((style) => (
          <Pressable
            key={style}
            style={[styles.chip, prefs.reminderStyle === style && styles.chipActive]}
            onPress={() => {
              services.notifications.updatePreferences(profile.id, { reminderStyle: style });
              reconcile();
            }}
          >
            <Text style={styles.chipText}>{style}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>Secondary reminder</Text>
      <Text style={styles.muted}>
        One optional nudge if the planned session is still open. Maximum two
        training reminders per day - always within the training day.
      </Text>
      <View style={styles.switchRow}>
        <Text style={styles.body}>Secondary reminder</Text>
        <Switch
          value={prefs.secondaryReminderEnabled}
          disabled={permission !== "granted" || !prefs.trainingRemindersEnabled}
          onValueChange={(v) => {
            services.notifications.updatePreferences(profile.id, { secondaryReminderEnabled: v });
            reconcile();
          }}
        />
      </View>
      {prefs.secondaryReminderEnabled ? (
        <View style={styles.row}>
          {DELAY_CHOICES.map((d) => (
            <Pressable
              key={d}
              style={[styles.chip, prefs.secondaryDelayMinutes === d && styles.chipActive]}
              onPress={() => {
                services.notifications.updatePreferences(profile.id, { secondaryDelayMinutes: d });
                reconcile();
              }}
            >
              <Text style={styles.chipText}>+{delayLabel(d)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={styles.section}>Rest timer notification</Text>
      <View style={styles.switchRow}>
        <Text style={styles.body}>Notify me when a rest ends</Text>
        <Switch
          value={prefs.restTimerNotificationsEnabled}
          disabled={permission !== "granted"}
          onValueChange={(v) => {
            services.notifications.updatePreferences(profile.id, { restTimerNotificationsEnabled: v });
            reconcile();
          }}
        />
      </View>

      {enabledDays.length > 0 ? (
        <>
          <Text style={styles.section}>Training-day times</Text>
          {enabledDays.map((day) => (
            <View key={day.weekday} style={styles.dayRow}>
              <Text style={styles.body}>{DAY_NAMES[day.weekday - 1]}</Text>
              <View style={styles.row}>
                {REMINDER_CHOICES.map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.chip, day.reminderMinutesAfterMidnight === m && styles.chipActive]}
                    onPress={() => setDayTime(day.weekday, day.reminderMinutesAfterMidnight === m ? null : m)}
                  >
                    <Text style={styles.chipText}>{minutesLabel(m)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </>
      ) : (
        <>
          <Text style={styles.section}>Training-day times</Text>
          <Text style={styles.muted}>Enable training days in your schedule first.</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  title: { ...type.sectionTitle, color: colors.text },
  section: { ...type.sectionTitle, color: colors.text, fontSize: 15, marginTop: space.md },
  body: { ...type.body, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginTop: space.sm, gap: space.xs },
  cardTitle: { ...type.body, color: colors.text, fontWeight: "700" },
  statusOk: { color: colors.success, marginTop: space.sm, fontWeight: "700" },
  statusOff: { color: colors.text, marginTop: space.sm, fontWeight: "700" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.sm },
  row: { flexDirection: "row", gap: space.xs, flexWrap: "wrap", marginTop: space.xs },
  dayRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.xs, flexWrap: "wrap", gap: space.xs },
  chip: { borderWidth: 1, borderColor: colors.textMuted, borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 4 },
  chipActive: { borderColor: colors.accent },
  chipText: { ...type.caption, color: colors.text },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: space.sm, alignItems: "center", marginTop: space.xs },
  primaryButtonText: { color: colors.textOnAccent, fontWeight: "800", letterSpacing: 1 },
  button: { backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md, marginTop: space.xs, alignSelf: "flex-start" },
  buttonText: { ...type.body, color: colors.accent, fontWeight: "700" },
  linkText: { ...type.body, color: colors.accent, marginTop: space.xs },
});
