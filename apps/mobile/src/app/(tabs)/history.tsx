import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useUnits } from "../../ui/units";
import { formatDateTime, formatDurationRough, formatVolume } from "../../ui/format";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Workout history (Phase 4, task Y): chronological completed workouts with
 * canonical statistics only (duration, counts, basic volume) - no ranks,
 * PRs, streaks or achievements.
 */
export default function HistoryScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  const profile = repos.profile.getDefault();

  // Canonical read on every render; the screen re-renders on navigation.
  const entries = profile
    ? services.workout.listHistory(profile.id).map((detail) => {
        const summary = services.workout.getSummary(detail.workout.id);
        return { detail, summary };
      })
    : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {entries.length === 0 ? (
        <Text style={styles.muted}>No completed workouts yet. Finish a workout to see it here.</Text>
      ) : (
        entries.map(({ detail, summary }) => (
          <Pressable
            key={detail.workout.id}
            style={styles.card}
            accessibilityLabel={"Open workout from " + detail.workout.startedAt}
            onPress={() => router.push("/history/" + detail.workout.id)}
          >
            <Text style={styles.title}>{detail.workout.title ?? "Workout"}</Text>
            <Text style={styles.date}>{formatDateTime(detail.workout.startedAt)}</Text>
            <View style={styles.statsRow}>
              <Text style={styles.stat}>{formatDurationRough(summary.durationSeconds)}</Text>
              <Text style={styles.stat}>{String(summary.exerciseCount)} ex</Text>
              <Text style={styles.stat}>{String(summary.completedSetCount)} sets</Text>
              <Text style={styles.stat}>{formatVolume(summary.volumeKg, units.weightLabel)}</Text>
            </View>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: 40 },
  muted: { ...typography.caption, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: 4, minHeight: 60 },
  title: { ...typography.body, color: colors.text, fontWeight: "700" },
  date: { ...typography.caption, color: colors.textMuted },
  statsRow: { flexDirection: "row", gap: 12, marginTop: 2, flexWrap: "wrap" },
  stat: { ...typography.caption, color: colors.accent, fontVariant: ["tabular-nums"] },
});