import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ActiveWorkoutConflictError, computeLogicalTrainingDate, resolveHomeSessionView } from "@openrank/database";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { RankBadge } from "../../components/ui/RankBadge";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Home (Phase 8.1 approved structure, spec 18/19) - "What should I do
 * today?". Greeting -> TODAY card -> streak/week strip -> strength profile
 * -> recent wins. All Phase 6/7.1 correctness semantics are preserved:
 *
 * - The root onboarding gate owns profile state; corruption shows a
 *   recoverable error and NEVER fabricates a profile.
 * - Future obligations are never silently reinterpreted (NEXT WORKOUT +
 *   VIEW PLAN + explicit bonus only; satisfaction requires an explicit
 *   reschedule).
 * - Recent wins are CANONICAL events only: personal-record events, rank
 *   events, streak state. Achievements never redefine these systems.
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
/** Green = completed only (spec 3); everything else neutral/amber-today. */
const WEEK_STATE_COLOR: Record<string, string> = {
  completed: colors.success,
  planned: colors.textSecondary,
  rest: colors.textMuted,
  missed: colors.danger,
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
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const schedule = services.schedule.getSchedule(profile.id);
  const week = services.schedule.getWeekState(profile.id, { timezoneOffsetMinutes: offset });
  const upcoming = services.schedule.getUpcomingSessions(profile.id, { timezoneOffsetMinutes: offset });
  const next = upcoming[0] ?? null;
  const streak = services.streak.getCurrentState(profile.id);
  const cache = streak.cache;
  const strength = services.derived.getStrengthProfile(profile.id);
  const recentPrs = repos.personalRecords.listEventsForProfile(profile.id, 3);
  const recentRankUps = services.derived.recentRankEvents(profile.id, 6).filter((e) => e.direction === "up").slice(0, 3);

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

  // Today card content per approved state variants (spec 19).
  const todayCard = (() => {
    if (view.kind === "today_planned" && next) {
      return (
        <>
          <Text style={styles.cardKicker}>TODAY</Text>
          <Text style={styles.cardTitle}>{routineFor(next.routineId)}</Text>
          <Text style={styles.cardMeta}>
            {schedule.schedule.enabled
              ? "Your planned session is ready."
              : "Schedule is disabled - obligations paused for now."}
          </Text>
          <Button label="START WORKOUT" onPress={startPlanned} fullWidth accessibilityLabel="Start today's planned workout" />
          <Pressable onPress={() => router.push("/reschedule/" + next.id)} accessibilityLabel="Reschedule this session">
            <Text style={styles.linkText}>Reschedule</Text>
          </Pressable>
        </>
      );
    }
    if (view.kind === "future" && next) {
      return (
        <>
          <Text style={styles.cardKicker}>NEXT WORKOUT</Text>
          <Text style={styles.cardTitle}>{routineFor(next.routineId)}</Text>
          <Text style={styles.cardMeta}>
            {"Planned for " + WEEKDAY_LONG[(new Date(next.scheduledDate + "T00:00:00Z").getUTCDay() + 6) % 7] +
              " (" + next.scheduledDate + "). Starting today is a bonus workout - it does not move the plan."}
          </Text>
          <Button label="VIEW PLAN" variant="primary" onPress={() => router.push("/schedule")} fullWidth />
          <Pressable onPress={startBonus} accessibilityLabel="Start a bonus workout">
            <Text style={styles.linkText}>Start bonus workout</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/reschedule/" + next.id)} accessibilityLabel="Reschedule this session">
            <Text style={styles.linkText}>Reschedule</Text>
          </Pressable>
        </>
      );
    }
    if (view.kind === "today_completed") {
      return (
        <>
          <Text style={styles.cardKicker}>TRAINING COMPLETE</Text>
          <Text style={styles.cardTitle}>{routineFor(next?.routineId ?? null)}</Text>
          <Text style={styles.cardMeta}>{"Today's session is done. Bonus training is always welcome."}</Text>
          <Button label="START BONUS WORKOUT" variant="secondary" onPress={startBonus} fullWidth />
        </>
      );
    }
    if (view.kind === "today_missed") {
      return (
        <>
          <Text style={styles.cardKicker}>REST DAY</Text>
          <Text style={styles.cardMeta}>
            Today was a planned training day. The next planned session starts a fresh streak - no drama.
          </Text>
          <Button label="START BONUS WORKOUT" variant="secondary" onPress={startBonus} fullWidth />
        </>
      );
    }
    if (view.kind === "none" && next) {
      return (
        <>
          <Text style={styles.cardKicker}>REST DAY</Text>
          <Text style={styles.cardTitle}>{routineFor(next.routineId)}</Text>
          <Text style={styles.cardMeta}>{"Next: " + nextLabel + " (" + next.scheduledDate + ")"}</Text>
          <Button label="START BONUS WORKOUT" variant="secondary" onPress={startBonus} fullWidth />
        </>
      );
    }
    return (
      <>
        <Text style={styles.cardKicker}>NO PLANNED SESSIONS</Text>
        <Text style={styles.cardMeta}>No upcoming planned sessions. Enable training days in your schedule.</Text>
        <Button label="EDIT SCHEDULE" variant="secondary" onPress={() => router.push("/schedule")} fullWidth />
      </>
    );
  })();

  const hasWins = recentPrs.length > 0 || recentRankUps.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>{greeting},</Text>
      <Text style={styles.name}>{profile.displayName}</Text>
      <Text style={styles.date}>{dateLabel}</Text>

      <Card variant="elevated" style={styles.todayCard}>
        {todayCard}
      </Card>

      <Card>
        <Text style={styles.streakMetric}>
          {String(cache.currentStreak) + " SESSION STREAK"}
        </Text>
        <Text style={styles.cardMeta}>{"Best " + String(cache.bestStreak) + " - " + String(cache.perfectWeeks) + " perfect weeks"}</Text>
        <View style={styles.weekRow}>
          {week.map((day, i) => (
            <View
              key={day.date}
              accessible
              accessibilityLabel={
                WEEKDAY_LONG[i] + (day.date === todayLogical ? " (today)" : "") + ": " + (WEEK_STATE_LABEL[day.state] ?? day.state)
              }
              style={[styles.weekCell, day.date === todayLogical ? styles.weekCellToday : null]}
            >
              <Text style={[styles.weekLetter, day.state === "rest" ? styles.weekLetterMuted : null]}>{WEEKDAY_LABELS[i]}</Text>
              <Text style={[styles.weekGlyph, { color: WEEK_STATE_COLOR[day.state] ?? colors.textMuted }]}>
                {WEEK_STATE_GLYPH[day.state] ?? "\u00B7"}
              </Text>
            </View>
          ))}
        </View>
        <Pressable onPress={() => router.push("/streak")} accessibilityLabel="Open streak history">
          <Text style={styles.linkText}>Streak history</Text>
        </Pressable>
      </Card>

      <Text style={styles.section}>STRENGTH PROFILE</Text>
      <Card>
        {strength.groups.map((g) => (
          <Pressable
            key={g.key}
            accessible
            accessibilityRole="button"
            accessibilityLabel={g.label + ": " + (g.tierName ? g.tierName + (g.division ? " " + g.division : "") : "no rank") + ", open rank detail"}
            onPress={() => router.push("/muscle/" + g.key)}
            style={styles.profileRow}
          >
            <Text style={styles.profileGroup}>{g.label}</Text>
            <View style={styles.profileRight}>
              <RankBadge tierName={g.tierName} division={g.division} size="sm" />
              <View style={styles.profileProgress}>
                {g.progress != null ? <ProgressBar value={g.progress} height={4} showValue={false} accessibilityLabel={g.label + " tier progress"} /> : null}
              </View>
            </View>
          </Pressable>
        ))}
        <Pressable onPress={() => router.push("/progress")} accessibilityLabel="View progress hub">
          <Text style={styles.linkText}>View progress \u2192</Text>
        </Pressable>
      </Card>

      {hasWins ? (
        <>
          <Text style={styles.section}>RECENT WINS</Text>
          <Card>
            {recentPrs.map((pr) => (
              <View key={pr.id} style={styles.winRow}>
                <Text style={styles.winBadge}>PR</Text>
                <Text style={styles.winText}>
                  {(repos.exercise.findById(pr.exerciseId)?.name ?? "Exercise") +
                    (pr.recordType === "max_weight"
                      ? " - " + String(Math.round(pr.value * 100) / 100) + " " + "kg"
                      : pr.recordType === "max_e1rm"
                        ? " - est. 1RM " + String(Math.round(pr.value * 10) / 10) + " kg"
                        : pr.recordType === "max_set_volume"
                          ? " - set volume " + String(Math.round(pr.value)) + " kg"
                          : " - " + String(Math.round(pr.value)) + " reps")}
                </Text>
              </View>
            ))}
            {recentRankUps.map((e) => (
              <View key={e.id} style={styles.winRow}>
                <Text style={[styles.winBadge, styles.winBadgeRank]}>RANK UP</Text>
                <Text style={styles.winText}>
                  {(e.scopeType === "muscle" ? (strength.groups.find((g) => g.key === e.scopeKey)?.label ?? e.scopeKey) : (repos.exercise.findById(e.scopeKey)?.name ?? e.scopeKey)) +
                    " \u2192 " + e.toTier + (e.toDivision ? " " + e.toDivision : "")}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <View style={styles.quickRow}>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Browse the exercise catalog"
          onPress={() => router.push("/(tabs)/exercises")}
          style={styles.quickLink}
        >
          <Text style={styles.quickLinkText}>Browse exercises</Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Open training schedule"
          onPress={() => router.push("/schedule")}
          style={styles.quickLink}
        >
          <Text style={styles.quickLinkText}>Training schedule</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space[4], paddingTop: space[5], gap: space[3], paddingBottom: space[10] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: space[5], gap: space[2] },
  errorTitle: { ...type.cardTitle, color: colors.danger },
  muted: { ...type.caption, color: colors.textMuted },
  greeting: { ...type.body, color: colors.textSecondary },
  name: { ...type.pageTitle, color: colors.text },
  date: { ...type.caption, color: colors.textMuted },
  todayCard: { gap: space[2], padding: space[5] },
  cardKicker: { ...type.label, color: colors.accent, letterSpacing: 1.2 },
  cardTitle: { ...type.cardTitle, color: colors.text },
  cardMeta: { ...type.caption, color: colors.textMuted },
  streakMetric: { ...type.metricSmall, color: colors.text, letterSpacing: 0.5 },
  section: { ...type.label, color: colors.textSecondary, letterSpacing: 1.2, marginTop: space[2] },
  weekRow: { flexDirection: "row", justifyContent: "space-between", marginTop: space[2] },
  weekCell: { alignItems: "center", flex: 1, gap: 2, paddingBottom: 3, borderBottomWidth: 2, borderBottomColor: "transparent" },
  weekCellToday: { borderBottomColor: colors.accent },
  weekLetter: { ...type.label, color: colors.textSecondary },
  weekLetterMuted: { color: colors.textMuted },
  weekGlyph: { ...type.bodyStrong, fontSize: 16 },
  profileRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: space[2] },
  profileGroup: { ...type.body, color: colors.text },
  profileRight: { flexDirection: "row", alignItems: "center", gap: space[3], flex: 1, justifyContent: "flex-end" },
  profileProgress: { width: 90 },
  winRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[1] },
  winBadge: {
    ...type.label,
    color: colors.accent,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
    minWidth: 36,
    textAlign: "center",
  },
  winBadgeRank: { color: colors.info, backgroundColor: "rgba(96,165,250,0.12)" },
  winText: { ...type.caption, color: colors.text, flex: 1 },
  quickRow: { flexDirection: "row", gap: space[3], marginTop: space[2] },
  quickLink: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: space[3],
    alignItems: "center",
  },
  quickLinkText: { ...type.caption, color: colors.textSecondary },
  linkText: { ...type.caption, color: colors.accent, fontWeight: "600", paddingVertical: space[1] },
});
