import { useLocalSearchParams } from "expo-router";
import { isPerfectWeek } from "@openrank/database";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useCanonicalRevision } from "../../local-data/useCanonicalRevision";
import { useUnits } from "../../ui/units";
import { formatDateTime, formatDurationRough, formatVolume } from "../../ui/format";
import { formatSetSummary } from "../../ui/format";
import { formatRankLabel } from "../../ui/format";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";
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
  useCanonicalRevision(); // canonical invalidation (Phase 8.2): PR/highlights refresh live

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
        <View style={styles.prCard}>
          <Text style={styles.prTitle}>NEW PR</Text>
          {[...prsByExercise.entries()].map(([name, labels]) => (
            <Text key={name} style={styles.highlightLine}>
              {name + " - " + labels}
            </Text>
          ))}
        </View>
      ) : null}

      {highlights.rankUps.length > 0 ? (
        <View style={styles.rankUpCard}>
          <Text style={styles.rankUpTitle}>RANK UP</Text>
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
  deferredNote: { ...type.caption, color: colors.textMuted, fontStyle: "italic" },
  highlightCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: 2, marginTop: space.xs },
  prCard: { backgroundColor: colors.accentSubtle, borderRadius: radius.md, padding: space.md, gap: 2, marginTop: space.xs },
  prTitle: { ...type.label, color: colors.accent, letterSpacing: 1.2 },
  rankUpCard: { backgroundColor: "rgba(96,165,250,0.12)", borderRadius: radius.md, padding: space.md, gap: 2, marginTop: space.xs },
  rankUpTitle: { ...type.label, color: colors.info, letterSpacing: 1.2 },
  highlightTitle: { ...type.label, color: colors.success, letterSpacing: 1.2 },
  highlightTitleMuted: { ...type.label, color: colors.textMuted, letterSpacing: 1.2 },
  highlightLine: { ...type.body, color: colors.text },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  muted: { ...type.caption, color: colors.textMuted },
  kicker: { ...type.label, color: colors.accent, letterSpacing: 1.2 },
  title: { ...type.sectionTitle, color: colors.text },
  date: { ...type.caption, color: colors.textMuted },
  summaryRow: { flexDirection: "row", gap: space.md, marginTop: space.sm, flexWrap: "wrap" },
  summaryItem: { alignItems: "flex-start" },
  summaryValue: { ...type.metricSmall, color: colors.text, fontVariant: ["tabular-nums"] },
  summaryLabel: { ...type.label, color: colors.textMuted, textTransform: "uppercase" },
  sectionLabel: { ...type.label, color: colors.textSecondary, letterSpacing: 1.2, marginTop: space.sm },
  volumeNote: { ...type.caption, color: colors.textMuted, fontStyle: "italic" },
  origin: { ...type.caption, color: colors.textMuted },
  notes: { ...type.body, color: colors.text, marginTop: space.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginTop: space.sm, gap: 3 },
  exerciseName: { ...type.bodyStrong, color: colors.text, textTransform: "uppercase" },
  setLine: { ...type.caption, color: colors.text, fontVariant: ["tabular-nums"], paddingLeft: space[2] },
});
