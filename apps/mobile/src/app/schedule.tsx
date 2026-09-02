import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SchedulePauseOverlapError, RescheduleError, computeLogicalTrainingDate } from "@openrank/database";
import type { ScheduleWeekday } from "@openrank/domain";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { colors, spacing, typography } from "../theme/tokens";

/**
 * Training schedule editor (Phase 6, spec AG/AH): weekly training days with
 * optional routine association, enable/disable, planned pauses and the
 * upcoming obligation list (reschedule entry point).
 */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export default function ScheduleScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const [nonce, setNonce] = useState(0);
  const [pauseDays, setPauseDays] = useState("3");
  const [pauseReason, setPauseReason] = useState("");
  const [reminderAskDismissed, setReminderAskDismissed] = useState(false);
  const refresh = () => setNonce((n) => n + 1);
  void nonce;

  const profile = repos.profile.getDefault();
  const offset = -new Date().getTimezoneOffset();
  const todayLogical = computeLogicalTrainingDate(new Date().toISOString(), offset);

  const reconcileNotifications = () => {
    void services.notifications
      .reconcileNotifications(profile?.id ?? "", {
        todayUtc: new Date().toISOString(),
        timezoneOffsetMinutes: offset,
      })
      .catch(() => {});
  };

  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Finish onboarding first.</Text>
      </View>
    );
  }

  const { schedule, days } = services.schedule.getSchedule(profile.id);
  const prefs = services.notifications.getPreferences(profile.id);
  const anyDayEnabled = days.some((d) => d.enabled);

  const askReminders = async () => {
    const status = await services.notifications.requestPermission(profile.id);
    if (status === "granted") {
      services.notifications.updatePreferences(profile.id, { trainingRemindersEnabled: true });
      services.notifications.setReminderTimeForEnabledDays(profile.id, 1020); // 17:00
      reconcileNotifications();
    }
    refresh();
  };
  const routines = services.routine.list(profile.id).active;
  const upcoming = services.schedule.getUpcomingSessions(profile.id, { timezoneOffsetMinutes: offset }).slice(0, 10);
  const pauses = services.schedule.listPauses(profile.id);
  const todayIndex = (new Date(todayLogical + "T00:00:00Z").getUTCDay() + 6) % 7;

  const toggleDay = (weekday: ScheduleWeekday) => {
    const next = days.map((d) =>
      d.weekday === weekday ? { ...d, enabled: !d.enabled } : { ...d, enabled: d.enabled },
    );
    services.schedule.updateWeeklySchedule(profile.id, next.map((d) => ({
      weekday: d.weekday, enabled: d.enabled, routineId: d.routineId,
    })), { timezoneOffsetMinutes: offset });
    refresh(); reconcileNotifications();
  };

  const assignRoutine = (weekday: ScheduleWeekday, routineId: string | null) => {
    services.schedule.updateWeeklySchedule(profile.id, days.map((d) => ({
      weekday: d.weekday, enabled: d.enabled, routineId: d.weekday === weekday ? routineId : d.routineId,
    })), { timezoneOffsetMinutes: offset });
    refresh(); reconcileNotifications();
  };

  const toggleSchedule = (enabled: boolean) => {
    services.schedule.setScheduleEnabled(profile.id, enabled, { timezoneOffsetMinutes: offset });
    refresh(); reconcileNotifications();
  };

  const addPause = () => {
    const days = Math.max(1, Math.min(30, Number(pauseDays) || 0));
    if (days === 0) {
      Alert.alert("Invalid length", "Enter the pause length in days (1-30).");
      return;
    }
    const start = todayLogical;
    const end = new Date(Date.parse(start + "T00:00:00Z") + (days - 1) * 86_400_000).toISOString().slice(0, 10);
    try {
      services.schedule.addPause(profile.id, start, end, pauseReason.trim() || null, { timezoneOffsetMinutes: offset });
      setPauseReason("");
      refresh(); reconcileNotifications();
    } catch (err) {
      if (err instanceof SchedulePauseOverlapError) {
        Alert.alert("Overlapping pause", "This overlaps an existing planned pause.");
        return;
      }
      throw err;
    }
  };

  const removePause = (id: string) => {
    try {
      services.schedule.removeFuturePause(id, { timezoneOffsetMinutes: offset });
      refresh(); reconcileNotifications();
    } catch (err) {
      if (err instanceof RescheduleError) {
        Alert.alert("Cannot remove", "A fully elapsed pause is history.");
        return;
      }
      throw err;
    }
  };

  const routineName = (routineId: string | null) =>
    routineId ? repos.routine.getById(routineId)?.routine.name ?? "Deleted routine" : "Freestyle";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Training schedule</Text>
      <Text style={styles.muted}>
        Pick the days you usually train. Rest days never break your streak.
        Changing the plan never rewrites history.
      </Text>

      <View style={styles.switchRow}>
        <Text style={styles.body}>Schedule enabled</Text>
        <Switch value={schedule.enabled} onValueChange={toggleSchedule} />
      </View>
      {!schedule.enabled ? (
        <Text style={styles.muted}>
          Disabled: no new obligations are created. Existing history is kept.
        </Text>
      ) : null}

      <Text style={styles.section}>Which days do you usually train?</Text>
      {days.map((day, i) => (
        <View key={day.weekday} style={styles.dayRow}>
          <Switch value={day.enabled} onValueChange={() => toggleDay(day.weekday)} />
          <Text style={[styles.body, day.enabled ? styles.bold : styles.muted]}>{DAY_NAMES[i]}</Text>
          {day.enabled ? (
            <View style={styles.routinePicker}>
              {routines.slice(0, 3).map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => assignRoutine(day.weekday, day.routineId === r.id ? null : r.id)}
                  style={[styles.chip, day.routineId === r.id && styles.chipActive]}
                >
                  <Text style={styles.chipText}>{r.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ))}

      {anyDayEnabled && prefs && !prefs.trainingRemindersEnabled && !prefs.permissionPromptSeen && !reminderAskDismissed ? (
        (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Would you like reminders on those days?</Text>
            <Text style={styles.muted}>
              OpenRank can remind you only on your training days - never on
              rest days. You can change this anytime.
            </Text>
            <Pressable style={styles.button} onPress={() => void askReminders()}>
              <Text style={styles.buttonText}>Enable reminders</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                services.notifications.updatePreferences(profile.id, { permissionPromptSeen: true });
                setReminderAskDismissed(true);
              }}
            >
              <Text style={styles.linkText}>Not now</Text>
            </Pressable>
          </View>
        )
      ) : null}

      <Text style={styles.section}>Planned pause / vacation</Text>
      <Text style={styles.muted}>
        Paused days count as neither trained nor missed. A pause never erases
        an already-finalized miss.
      </Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={pauseDays}
          onChangeText={setPauseDays}
          placeholder="days"
          keyboardType="number-pad"
          placeholderTextColor={colors.textMuted}
        />
        <TextInput
          style={[styles.input, { flex: 2 }]}
          value={pauseReason}
          onChangeText={setPauseReason}
          placeholder="reason (optional)"
          placeholderTextColor={colors.textMuted}
        />
        <Pressable style={styles.button} onPress={addPause}>
          <Text style={styles.buttonText}>Add pause</Text>
        </Pressable>
      </View>
      {pauses.map((p) => (
        <View key={p.id} style={styles.pauseRow}>
          <Text style={styles.body}>
            {p.startDate + " to " + p.endDate + (p.reason ? " - " + p.reason : "")}
          </Text>
          <Pressable onPress={() => removePause(p.id)}>
            <Text style={styles.linkText}>Remove</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.section}>Upcoming planned sessions</Text>
      {upcoming.length === 0 ? (
        <Text style={styles.muted}>Nothing scheduled. Enable some days above.</Text>
      ) : (
        upcoming.map((s) => (
          <View key={s.id} style={styles.sessionRow}>
            <Text style={styles.body}>
              {s.scheduledDate + " - " + routineName(s.routineId)}
            </Text>
            <Pressable onPress={() => router.push("/reschedule/" + s.id)}>
              <Text style={styles.linkText}>Reschedule</Text>
            </Pressable>
          </View>
        ))
      )}
      <Text style={styles.muted}>Today: {todayLogical} ({DAY_NAMES[todayIndex]})</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  title: { ...typography.title, color: colors.text },
  section: { ...typography.title, color: colors.text, fontSize: 16, marginTop: spacing.md },
  body: { ...typography.body, color: colors.text },
  bold: { fontWeight: "700" },
  muted: { ...typography.caption, color: colors.textMuted },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  dayRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs, flexWrap: "wrap" },
  routinePicker: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", flex: 1 },
  chip: { borderWidth: 1, borderColor: colors.textMuted, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipActive: { borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 12 },
  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  button: { backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginTop: spacing.sm, gap: spacing.xs },
  cardTitle: { ...typography.body, color: colors.text, fontWeight: "700" },
  linkText: { color: colors.accent, fontWeight: "700" },
  buttonText: { color: colors.accent, fontWeight: "700" },
  pauseRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs },
  sessionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs },
});