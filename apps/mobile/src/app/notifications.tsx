import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { NotificationPermissionStatus, ScheduleWeekday } from "@openrank/domain";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { colors, spacing, typography } from "../theme/tokens";

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
  const [nonce, setNonce] = useState(0);
  const [permission, setPermission] = useState<NotificationPermissionStatus>("undetermined");

  const profile = repos.profile.getDefault();
  const refresh = () => setNonce((n) => n + 1);
  void nonce;

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
    refresh();
  };

  const openSystemSettings = () => {
    void import("expo-linking").then((Linking) => Linking.openSettings());
  };

  const setDayTime = (weekday: ScheduleWeekday, minutes: number | null) => {
    services.notifications.setDayReminderTime(profile.id, weekday, minutes);
    reconcile();
    refresh();
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
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Never miss a planned workout</Text>
          <Text style={styles.muted}>
            OpenRank can remind you only on the training days you choose.
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => void enableReminders()}>
            <Text style={styles.primaryButtonText}>Enable reminders</Text>
          </Pressable>
          <Pressable onPress={() => refresh()}>
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
            refresh();
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
              refresh();
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
            refresh();
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
                refresh();
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
            refresh();
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
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  title: { ...typography.title, color: colors.text },
  section: { ...typography.title, color: colors.text, fontSize: 15, marginTop: spacing.md },
  body: { ...typography.body, color: colors.text },
  muted: { ...typography.caption, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginTop: spacing.sm, gap: spacing.xs },
  cardTitle: { ...typography.body, color: colors.text, fontWeight: "700" },
  statusOk: { color: colors.accent, marginTop: spacing.sm, fontWeight: "700" },
  statusOff: { color: colors.text, marginTop: spacing.sm, fontWeight: "700" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  row: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", marginTop: spacing.xs },
  dayRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs, flexWrap: "wrap", gap: spacing.xs },
  chip: { borderWidth: 1, borderColor: colors.textMuted, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipActive: { borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 12 },
  primaryButton: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: spacing.sm, alignItems: "center", marginTop: spacing.xs },
  primaryButtonText: { color: colors.background, fontWeight: "800", letterSpacing: 1 },
  button: { backgroundColor: colors.surface, borderRadius: 10, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.xs, alignSelf: "flex-start" },
  buttonText: { color: colors.accent, fontWeight: "700" },
  linkText: { color: colors.accent, marginTop: spacing.xs },
});
