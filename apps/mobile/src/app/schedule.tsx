import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SchedulePauseOverlapError, RescheduleError, computeLogicalTrainingDate } from "@openrank/database";
import type { ScheduleWeekday } from "@openrank/domain";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { colors } from "../design/colors";
import { radius } from "../design/radii";
import { space } from "../design/spacing";
import { type } from "../design/typography";

/**
 * Training schedule editor (Phase 6, spec AG/AH): weekly training days with
 * optional routine association, enable/disable, planned pauses and the
 * upcoming obligation list (reschedule entry point). Phase 8.1: day toggles
 * use the approved weekday-circle treatment (selected = filled amber).
 */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const SHORT_DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

export default function ScheduleScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const [nonce, setNonce] = useState(0);
  const [pauseReason, setPauseReason] = useState("");
  const [reminderAskDismissed, setReminderAskDismissed] = useState(false);
  const [pickerDay, setPickerDay] = useState<ScheduleWeekday | null>(null);
  const refresh = () => setNonce((n) => n + 1);
  void nonce;

  const profile = repos.profile.getDefault();
  const offset = -new Date().getTimezoneOffset();
  const todayLogical = computeLogicalTrainingDate(new Date().toISOString(), offset);
  const [pauseFrom, setPauseFrom] = useState(todayLogical);
  const [pauseTo, setPauseTo] = useState(todayLogical);

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
        <Text style={styles.muted}>Internal state error - the local profile is missing. Restart the app to recover.</Text>
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

  const isValidIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));

  const addPause = () => {
    // Explicit validated From/To range (spec 27). The service layer keeps
    // Phase 6 semantics: overlap rejection, no retroactive rescue.
    if (!isValidIsoDate(pauseFrom.trim()) || !isValidIsoDate(pauseTo.trim())) {
      Alert.alert("Invalid date", "Enter dates as YYYY-MM-DD.");
      return;
    }
    const start = pauseFrom.trim();
    const end = pauseTo.trim();
    if (start > end) {
      Alert.alert("Invalid range", "The start date must be on or before the end date.");
      return;
    }
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
      <View style={styles.dayCircles}>
        {days.map((day) => (
          <Pressable
            key={day.weekday}
            accessible
            accessibilityRole="switch"
            accessibilityLabel={DAY_NAMES[day.weekday - 1]}
            accessibilityState={{ checked: day.enabled }}
            onPress={() => toggleDay(day.weekday)}
            style={[styles.dayCircle, day.enabled ? styles.dayCircleSelected : null]}
          >
            <Text
              style={[
                styles.dayCircleText,
                day.enabled ? styles.dayCircleTextSelected : null,
              ]}
            >
              {SHORT_DAY_NAMES[day.weekday - 1]}
            </Text>
          </Pressable>
        ))}
      </View>
      {days.filter((d) => d.enabled).map((day) => (
        <View key={day.weekday} style={styles.dayRow}>
          <Text style={styles.body}>{DAY_NAMES[day.weekday - 1]}</Text>
          <Pressable
            onPress={() => setPickerDay(day.weekday)}
            accessibilityLabel={"Choose routine for " + DAY_NAMES[day.weekday - 1]}
            style={styles.pickerButton}
          >
            <Text style={styles.pickerText}>{routineName(day.routineId)}</Text>
            <Text style={styles.pickerCaret}>{"\u25BE"}</Text>
          </Pressable>
        </View>
      ))}

      <Modal visible={pickerDay != null} transparent animationType="fade" onRequestClose={() => setPickerDay(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerDay(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {pickerDay ? "Routine for " + DAY_NAMES[(pickerDay - 1)] : "Choose routine"}
            </Text>
            <Pressable
              onPress={() => {
                if (pickerDay) assignRoutine(pickerDay, null);
                setPickerDay(null);
              }}
              style={styles.modalRow}
            >
              <Text style={styles.modalRowText}>Freestyle (no routine)</Text>
            </Pressable>
            {routines.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => {
                  if (pickerDay) assignRoutine(pickerDay, r.id);
                  setPickerDay(null);
                }}
                style={styles.modalRow}
              >
                <Text style={styles.modalRowText}>{r.name}</Text>
              </Pressable>
            ))}
            {routines.length === 0 ? (
              <Text style={styles.muted}>No routines yet - create one from the Routines tab.</Text>
            ) : null}
          </View>
        </Pressable>
      </Modal>

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
        <View style={styles.pauseField}>
          <Text style={styles.pauseLabel}>From</Text>
          <TextInput
            style={styles.input}
            value={pauseFrom}
            onChangeText={setPauseFrom}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            accessibilityLabel="Pause start date"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.pauseField}>
          <Text style={styles.pauseLabel}>To</Text>
          <TextInput
            style={styles.input}
            value={pauseTo}
            onChangeText={setPauseTo}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            accessibilityLabel="Pause end date"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 2 }]}
          value={pauseReason}
          onChangeText={setPauseReason}
          placeholder="Reason (e.g. Vacation)"
          placeholderTextColor={colors.textMuted}
        />
        <Pressable style={styles.button} onPress={addPause}>
          <Text style={styles.buttonText}>SAVE</Text>
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
  dayCircles: { flexDirection: "row", justifyContent: "space-between", marginTop: space.sm },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  dayCircleText: { ...type.label, color: colors.textMuted, letterSpacing: 0.5 },
  dayCircleTextSelected: { color: colors.textOnAccent },
  pickerButton: {
    flex: 1,
    minWidth: 140,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  pickerText: { ...type.body, color: colors.text, fontSize: 13 },
  pickerCaret: { ...type.body, color: colors.textMuted, fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, width: "86%", gap: 6 },
  modalTitle: { ...type.bodyStrong, color: colors.text, marginBottom: 4 },
  modalRow: { paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: colors.border },
  modalRowText: { ...type.body, color: colors.text },
  pauseField: { flex: 1 },
  pauseLabel: { ...type.label, color: colors.textMuted, textTransform: "uppercase", marginBottom: 2, letterSpacing: 1 },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  title: { ...type.sectionTitle, color: colors.text },
  section: { ...type.sectionTitle, color: colors.text, fontSize: 16, marginTop: space.md },
  body: { ...type.body, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.sm },
  dayRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs, flexWrap: "wrap" },
  row: { flexDirection: "row", gap: space.sm, marginTop: space.sm, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  button: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginTop: space.sm, gap: space.xs },
  cardTitle: { ...type.body, color: colors.text, fontWeight: "700" },
  linkText: { ...type.body, color: colors.accent, fontWeight: "700" },
  buttonText: { ...type.body, color: colors.accent, fontWeight: "700" },
  pauseRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space.xs },
  sessionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space.xs },
});
