import { useLocalSearchParams } from "expo-router";
import { isPerfectWeek } from "@openrank/database";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useUnits } from "../../ui/units";
import { formatDateTime, formatDurationRough, formatVolume } from "../../ui/format";
import { formatSetSummary } from "../../ui/format";
import { formatRankLabel } from "../../ui/format";
import { colors, spacing, typography } from "../../theme/tokens";
import { BarChart } from "../../features/charts/BarChart";

/**
 * Workout detail / Phase 4 summary (tasks X/Y): canonical, non-derived
 * information only - duration, set/exercise counts, logged volume (a basic
 * training statistic), per-exercise completed sets, notes, timestamps and
 * routine origin. No PRs, ranks, streaks or achievements. Read-only.
 */
export default function HistoryDetailScreen() {
  const params = useLocalSearchParams<{ id: string; derived?: string; streak?: string }>();
  const workoutId = typeof params.id === "string" ? params.id : "";
  const derivedStatus = typeof params.derived === "string" ? params.derived : null;
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();

  let data: ReturnType<typeof services.workout.getSummary> | null = null;
  try {
    data = workoutId ? services.workout.getSummary(workoutId) : null;
  } catch {
    data = null;
  }
  if (!data) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Workout not found.</Text>
      </View>
    );
  }

  const { workout } = data;
  const routineName = workout.routineId
    ? (repos.routine.getById(workout.routineId)?.routine.name ?? "deleted routine")
    : null;
  const highlights = services.derived.getWorkoutHighlights(workoutId);

  // Streak integration (Phase 6, spec AJ): shown only when this workout
  // actually resolved a scheduled obligation; bonus workouts get the honest,
  // friendly variant. streak_after is the projection's read model.
  const scheduled = workoutId ? repos.scheduledSessions.forWorkout(workoutId) : null;
  const streakDeferred = params.streak === "deferred";
  const streakDelta =
    scheduled && scheduled.status === "completed" && scheduled.streakAfter != null
      ? scheduled.streakAfter
      : null;
  const perfectWeek =
    scheduled && scheduled.status === "completed"
      ? isPerfectWeek(repos.scheduledSessions.forProfile(workout.profileId), scheduled.scheduledDate)
      : false;
  const currentStreak = services.streak.getCurrentState(workout.profileId).cache.currentStreak;
  const prsByExercise = new Map<string, string>();
  for (const pr of highlights.prs) {
    const name = repos.exercise.findById(pr.exerciseId)?.name ?? "exercise";
    const label =
      (pr.recordType === "max_weight"
        ? "max weight"
        : pr.recordType === "max_e1rm"
          ? "est. 1RM"
          : pr.recordType === "max_set_volume"
            ? "set volume"
            : "reps @ weight") +
      " " +
      String(Math.round(pr.value * 100) / 100) +
      (pr.recordType === "max_reps_at_weight" ? "" : "");
    prsByExercise.set(name, (prsByExercise.get(name) ? prsByExercise.get(name) + ", " : "") + label);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>{workout.status === "completed" ? "WORKOUT COMPLETE" : "WORKOUT"}</Text>
      <Text style={styles.title}>{workout.title ?? "Workout"}</Text>
      <Text style={styles.date}>{formatDateTime(workout.startedAt)}</Text>

      {workout.status === "completed" ? (
        derivedStatus === "deferred" ? (
          <Text style={styles.deferredNote}>
            Workout is safely saved. Ranks will be recalculated automatically.
          </Text>
        ) : (
          <Text style={styles.deferredNote}>
            Workout saved successfully. Updating records and ranks...
          </Text>
        )
      ) : null}

      {prsByExercise.size > 0 ? (
        <View style={styles.highlightCard}>
          <Text style={styles.highlightTitle}>NEW PR</Text>
          {[...prsByExercise.entries()].map(([name, labels]) => (
            <Text key={name} style={styles.highlightLine}>
              {name + " - " + labels}
            </Text>
          ))}
        </View>
      ) : null}

      {highlights.rankUps.length > 0 ? (
        <View style={styles.highlightCard}>
          <Text style={styles.highlightTitle}>RANK UP</Text>
          {highlights.rankUps.map((e) => (
            <Text key={e.id} style={styles.highlightLine}>
              {formatRankLabel(e.toTier, e.toDivision) +
                (e.scopeType === "muscle" ? "" : " (exercise)")}
            </Text>
          ))}
        </View>
      ) : null}
      {highlights.rankDowns.length > 0 ? (
        <View style={styles.highlightCard}>
          <Text style={styles.highlightTitleMuted}>RANK CHANGED</Text>
          {highlights.rankDowns.map((e) => (
            <Text key={e.id} style={styles.highlightLine}>
              {formatRankLabel(e.toTier, e.toDivision) + " - ranks follow your bodyweight and history"}
            </Text>
          ))}
        </View>
      ) : null}

      {workout.status === "completed" ? (
        streakDeferred ? (
          <Text style={styles.deferredNote}>
            Workout saved successfully. Your training streak is being updated.
          </Text>
        ) : streakDelta != null ? (
          <View style={styles.highlightCard}>
            <Text style={styles.highlightTitle}>{"\u{1F525} STREAK"}</Text>
            <Text style={styles.highlightLine}>
              {String(streakDelta - 1) + " \u2192 " + String(streakDelta)}
            </Text>
            {perfectWeek ? (
              <Text style={styles.highlightLine}>Perfect week completed</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.highlightCard}>
            <Text style={styles.highlightTitleMuted}>BONUS WORKOUT</Text>
            <Text style={styles.highlightLine}>
              {"No session was planned for this day - it does not change your " +
                String(currentStreak) + "-session planned streak. Nice extra training."}
            </Text>
          </View>
        )
      ) : null}

      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{formatDurationRough(data.durationSeconds)}</Text>
          <Text style={styles.summaryLabel}>duration</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{String(data.completedSetCount)}</Text>
          <Text style={styles.summaryLabel}>sets</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{String(data.exerciseCount)}</Text>
          <Text style={styles.summaryLabel}>exercises</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{formatVolume(data.volumeKg, units.weightLabel)}</Text>
          <Text style={styles.summaryLabel}>volume</Text>
        </View>
      </View>
      <Text style={styles.volumeNote}>Logged volume is a basic training statistic, not a ranking score.</Text>

      {data.completedSetCount > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Volume by exercise</Text>
          <BarChart
            points={services.analytics
              .workoutVolumeBreakdown(workoutId, (id) => repos.exercise.findById(id)?.name ?? null)
              .map((s) => ({
                label: (s.exerciseName ?? "exercise").split(" ")[0]!,
                value: s.volumeKg,
                accessibilityLabel:
                  (s.exerciseName ?? "exercise") + ": " + formatVolume(s.volumeKg, units.weightLabel) +
                  " across " + String(s.completedSets) + " completed sets",
              }))}
            unitLabel={"Completed volume per exercise (" + units.weightLabel + ")"}
            highlightFraction={0.999}
            emptyText="No completed sets in this workout."
          />
        </>
      ) : null}

      {routineName ? <Text style={styles.origin}>from routine: {routineName}</Text> : null}
      {workout.finishedAt ? (
        <Text style={styles.origin}>finished {formatDateTime(workout.finishedAt)}</Text>
      ) : null}
      {workout.notes ? <Text style={styles.notes}>{workout.notes}</Text> : null}

      {data.exercises.map((e, i) => (
        <View key={e.exerciseId + "-" + String(i)} style={styles.card}>
          <Text style={styles.exerciseName}>{e.name}</Text>
          {e.sets.length === 0 ? (
            <Text style={styles.muted}>No completed sets.</Text>
          ) : (
            e.sets.map((s, si) => (
              <Text key={s.id} style={styles.setLine}>
                {String(si + 1) + ".  "}
                {s.setType !== "normal" ? "[" + s.setType + "] " : ""}
                {formatSetSummary(s, units)}
                {s.rpe != null ? "  RPE " + String(s.rpe) : ""}
                {s.rir != null ? "  RIR " + String(s.rir) : ""}
              </Text>
            ))
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  deferredNote: { ...typography.caption, color: colors.textMuted, fontStyle: "italic" },
  highlightCard: { backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, gap: 2, marginTop: spacing.xs },
  highlightTitle: { color: colors.success, fontWeight: "800", letterSpacing: 1.2, fontSize: 12 },
  highlightTitleMuted: { color: colors.textMuted, fontWeight: "800", letterSpacing: 1.2, fontSize: 12 },
  highlightLine: { color: colors.text, ...typography.body },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  muted: { ...typography.caption, color: colors.textMuted },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  title: { ...typography.title, color: colors.text },
  date: { ...typography.caption, color: colors.textMuted },
  summaryRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm, flexWrap: "wrap" },
  summaryItem: { alignItems: "flex-start" },
  summaryValue: { color: colors.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  summaryLabel: { color: colors.textMuted, fontSize: 11, textTransform: "uppercase" },
  sectionLabel: { ...typography.title, color: colors.text, fontSize: 18, marginTop: spacing.sm },
  volumeNote: { ...typography.caption, color: colors.textMuted, fontStyle: "italic" },
  origin: { ...typography.caption, color: colors.textMuted },
  notes: { ...typography.body, color: colors.text, marginTop: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginTop: spacing.sm, gap: 3 },
  exerciseName: { ...typography.body, color: colors.text, fontWeight: "700", textTransform: "uppercase" },
  setLine: { ...typography.caption, color: colors.text, fontVariant: ["tabular-nums"], paddingLeft: 8 },
});