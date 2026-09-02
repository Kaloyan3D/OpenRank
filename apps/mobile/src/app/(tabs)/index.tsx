import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ActiveWorkoutConflictError, computeLogicalTrainingDate, resolveHomeSessionView } from "@openrank/database";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Home (Phase 6 spec AD/AE/AF/AT + Phase 7.1 spec 23/24/25).
 *
 * - The root onboarding gate owns profile state; if Home ever renders without
 *   a profile (corruption) it shows a recoverable internal-state error and
 *   NEVER silently creates a replacement profile.
 * - Future obligations are never silently reinterpreted: a planned session
 *   belonging to a FUTURE logical training day renders as NEXT WORKOUT with
 *   VIEW PLAN + an explicit BONUS choice - starting it cannot satisfy the
 *   future obligation (that requires an explicit reschedule to today).
 * - Week strip: compact glyphs with full textual accessibility labels (never
 *   color alone).
 */

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const WEEKDAY_LONG = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const WEEK_STATE_GLYPH: Record<string, string> = {
  completed: "\u2713",
  planned: "\u25CB",
  rest: "\u00B7",
  missed: "\u2715",
  paused: "\u23F8",
  rescheduled: "\u21BB",
};
const WEEK_STATE_LABEL: Record<string, string> = {
  completed: "Completed",
  planned: "Planned",
  rest: "Rest day",
  missed: "Missed",
  paused: "Paused",
  rescheduled: "Rescheduled",
};
const WEEK_STATE_COLOR: Record<string, string> = {
  completed: colors.accent,
  planned: colors.text,
  rest: colors.textMuted,
  missed: "#e8a0a0",
  paused: colors.textMuted,
  rescheduled: colors.textMuted,
};

export default function HomeScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const [nonce, setNonce] = useState(0);
  void nonce;

  const profile = repos.profile.getDefault();
  if (!profile) {
    // The root gate owns this; reaching here means state corruption. Never
    // fabricate a profile (spec 23).
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Internal state error</Text>
        <Text style={styles.muted}>The local profile is missing. Restart the app to recover.</Text>
      </View>
    );
  }

  const offset = -new Date().getTimezoneOffset();
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const schedule = services.schedule.getSchedule(profile.id);
  const week = services.schedule.getWeekState(profile.id, { timezoneOffsetMinutes: offset });
  const upcoming = services.schedule.getUpcomingSessions(profile.id, { timezoneOffsetMinutes: offset });
  const next = upcoming[0] ?? null;
  const streak = services.streak.getCurrentState(profile.id);
  const cache = streak.cache;

  const todayLogical = computeLogicalTrainingDate(now.toISOString(), offset);
  const stateFor = (date: string) => week.find((d) => d.date === date)?.state ?? "rest";
  const view = resolveHomeSessionView({
    todayLogical,
    todaysState: stateFor(todayLogical),
    next: next ? { id: next.id, scheduledDate: next.scheduledDate } : null,
  });

  const routineFor = (routineId: string | null) =>
    routineId ? repos.routine.getById(routineId)?.routine.name ?? "Deleted routine" : "Freestyle session";

  const startBonus = () => {
    try {
      const w = services.workout.startEmptyWorkout(profile.id, { timezoneOffsetMinutes: offset });
      router.push("/workout/" + w.id);
    } catch (err) {
      if (err instanceof ActiveWorkoutConflictError) {
        router.push("/(tabs)/workout");
        return;
      }
      throw err;
    }
  };

  const startPlanned = () => {
    if (!next) return;
    try {
      const w = next.routineId
        ? services.workout.startWorkoutFromRoutine(profile.id, next.routineId, { timezoneOffsetMinutes: offset })
        : services.workout.startEmptyWorkout(profile.id, { timezoneOffsetMinutes: offset });
      router.push("/workout/" + w.id);
    } catch (err) {
      if (err instanceof ActiveWorkoutConflictError) {
        router.push("/(tabs)/workout");
        return;
      }
      throw err;
    }
    setNonce((n) => n);
  };

  const nextLabel = next
    ? WEEKDAY_LONG[(new Date(next.scheduledDate + "T00:00:00Z").getUTCDay() + 6) % 7]
    : null;
  const sectionTitle =
    view.kind === "today_planned"
      ? "TODAY - TRAINING DAY"
      : view.kind === "today_completed"
        ? "TODAY - DONE"
        : view.kind === "today_missed"
          ? "TODAY - TRAINING DAY (MISSED)"
          : next
            ? "NEXT WORKOUT"
            : "NO PLANNED SESSIONS";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>{greeting}</Text>
      <Text style={styles.streakLine}>
        {"\u{1F525} " + String(cache.currentStreak) + " session" + (cache.currentStreak === 1 ? "" : "s") + " streak"}
      </Text>
      <Text style={styles.muted}>A streak counts planned training sessions, not calendar days.</Text>

      <Text style={styles.section}>THIS WEEK</Text>
      <View style={styles.weekRow}>
        {week.map((day, i) => (
          <View
            key={day.date}
            style={[styles.weekCell, day.date === todayLogical && styles.weekCellToday]}
            accessibilityLabel={
              WEEKDAY_LONG[i] + (day.date === todayLogical ? " (today)" : "") + ": " + (WEEK_STATE_LABEL[day.state] ?? day.state)
            }
          >
            <Text style={[styles.weekLetter, day.state === "rest" && styles.muted]}>{WEEKDAY_LABELS[i]}</Text>
            <Text style={[styles.weekGlyph, { color: WEEK_STATE_COLOR[day.state] ?? colors.text }]}>
              {WEEK_STATE_GLYPH[day.state] ?? "\u00B7"}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.legend}>
        {"\u2713 Completed   \u25CB Planned   \u00B7 Rest   \u2715 Missed   \u23F8 Paused   \u21BB Rescheduled"}
      </Text>

      <Text style={styles.section}>{sectionTitle}</Text>
      {view.kind === "today_planned" && next ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{nextLabel + " - " + routineFor(next.routineId)}</Text>
          {schedule.schedule.enabled ? null : (
            <Text style={styles.muted}>Schedule is disabled - obligations paused for now.</Text>
          )}
          <Pressable style={styles.primaryButton} onPress={startPlanned}>
            <Text style={styles.primaryButtonText}>START WORKOUT</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/reschedule/" + next.id)} accessibilityLabel="Reschedule this session">
            <Text style={styles.linkText}>Reschedule</Text>
          </Pressable>
        </View>
      ) : view.kind === "future" && next ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{nextLabel + " - " + routineFor(next.routineId)}</Text>
          <Text style={styles.muted}>
            {"Planned for " + next.scheduledDate + ". Starting today is a bonus workout - it does not move the plan."}
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => router.push("/schedule")}>
            <Text style={styles.primaryButtonText}>VIEW PLAN</Text>
          </Pressable>
          <Pressable onPress={startBonus} accessibilityLabel="Start a bonus workout">
            <Text style={styles.linkText}>Start bonus workout</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/reschedule/" + next.id)} accessibilityLabel="Reschedule this session">
            <Text style={styles.linkText}>Reschedule</Text>
          </Pressable>
        </View>
      ) : view.kind === "today_completed" ? (
        <View style={styles.card}>
          <Text style={styles.muted}>{"Today's session is done. Bonus training is always welcome."}</Text>
          <Pressable style={styles.secondaryBigButton} onPress={startBonus}>
            <Text style={styles.secondaryBigText}>START BONUS WORKOUT</Text>
          </Pressable>
        </View>
      ) : view.kind === "today_missed" ? (
        <View style={styles.card}>
          <Text style={styles.muted}>
            {"Today was a training day. The next planned session starts a fresh streak - no drama."}
          </Text>
          <Pressable style={styles.secondaryBigButton} onPress={startBonus}>
            <Text style={styles.secondaryBigText}>START BONUS WORKOUT</Text>
          </Pressable>
        </View>
      ) : view.kind === "none" && next ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{nextLabel + " - " + routineFor(next.routineId)}</Text>
          <Text style={styles.muted}>No pending obligation right now.</Text>
          <Pressable style={styles.secondaryBigButton} onPress={startBonus}>
            <Text style={styles.secondaryBigText}>START BONUS WORKOUT</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.muted}>No upcoming planned sessions. Enable training days in your schedule.</Text>
          <Pressable style={styles.primaryButton} onPress={() => router.push("/schedule")}>
            <Text style={styles.primaryButtonText}>EDIT SCHEDULE</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.streakCard}>
        <Text style={styles.cardTitle}>{"\u{1F525} Current streak: " + String(cache.currentStreak)}</Text>
        <Text style={styles.cardTitle}>{"\u{1F3C6} Best streak: " + String(cache.bestStreak)}</Text>
        <Text style={styles.cardTitle}>{"\u{1F4C5} Perfect weeks: " + String(cache.perfectWeeks)}</Text>
        {streak.lastMissedSessionDate ? (
          <Text style={styles.muted}>
            {"Last miss: " + streak.lastMissedSessionDate + " - completed since: " + String(streak.completedSinceLastMiss)}
          </Text>
        ) : (
          <Text style={styles.muted}>No missed planned sessions recorded.</Text>
        )}
        <Pressable onPress={() => router.push("/streak")}>
          <Text style={styles.linkText}>Streak history</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <Pressable style={styles.secondaryButton} onPress={() => router.push("/schedule")}>
          <Text style={styles.secondaryButtonText}>Training schedule</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => router.push("/(tabs)/ranks")}>
          <Text style={styles.secondaryButtonText}>Strength Profile</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg, gap: 8 },
  errorTitle: { color: "#ff6b6b", fontSize: 16, fontWeight: "700" },
  greeting: { ...typography.title, color: colors.text },
  streakLine: { ...typography.title, color: colors.accent, fontSize: 22 },
  section: { ...typography.title, color: colors.text, fontSize: 14, marginTop: spacing.md, letterSpacing: 1 },
  muted: { ...typography.caption, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginTop: spacing.sm, gap: spacing.xs },
  streakCard: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginTop: spacing.md, gap: spacing.xs },
  cardTitle: { ...typography.body, color: colors.text, fontWeight: "700" },
  weekRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  weekCell: { alignItems: "center", flex: 1, gap: 2, paddingBottom: 2 },
  weekCellToday: { borderBottomWidth: 2, borderBottomColor: colors.accent },
  weekLetter: { color: colors.text, fontSize: 12, fontWeight: "700" },
  weekGlyph: { fontSize: 18, fontWeight: "700" },
  legend: { color: colors.textMuted, fontSize: 10, marginTop: spacing.xs },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  primaryButtonText: { color: colors.background, fontWeight: "800", letterSpacing: 1 },
  secondaryBigButton: {
    borderWidth: 1,
    borderColor: "#2a3242",
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  secondaryBigText: { color: colors.text, fontWeight: "700", letterSpacing: 0.5 },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    flex: 1,
    alignItems: "center",
  },
  secondaryButtonText: { color: colors.accent, fontWeight: "700" },
  linkText: { color: colors.accent, marginTop: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm },
});
