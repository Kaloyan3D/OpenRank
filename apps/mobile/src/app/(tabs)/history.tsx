import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useCanonicalRevision } from "../../local-data/useCanonicalRevision";
import { formatDateTime, formatDurationRough } from "../../ui/format";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineError } from "../../components/ui/InlineError";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { radius } from "../../design/radii";
import { type } from "../../design/typography";

/**
 * History (Phase 8.1 approved structure, spec 20): compact dark cards -
 * date, workout name, duration, completed sets, PR badge when a genuine
 * canonical PR event exists. Virtualized via FlatList (long history).
 * No charts in the list. Empty state is intentional and honest.
 */
interface HistoryEntry {
  workoutId: string;
  startedAt: string;
  title: string;
  durationSeconds: number;
  completedSetCount: number;
  volumeKg: number;
  hasPr: boolean;
}

export default function HistoryScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  // reloadKey is ONLY the manual retry for a failed read (transient UI state).
  // Fresh canonical data arrives via the revision: finishing a workout
  // publishes -> this memo recomputes -> the new workout is listed (K).
  const [reloadKey, setReloadKey] = useState(0);
  const revision = useCanonicalRevision();

  const profile = repos.profile.getDefault();

  const entries = useMemo<HistoryEntry[] | null>(() => {
    try {
      if (!profile) return [];
      return services.workout.listHistory(profile.id).map((detail) => {
        const summary = services.workout.getSummary(detail.workout.id);
        return {
          workoutId: detail.workout.id,
          startedAt: detail.workout.startedAt,
          title: detail.workout.title ?? "Workout",
          durationSeconds: summary.durationSeconds,
          completedSetCount: summary.completedSetCount,
          volumeKg: summary.volumeKg,
          hasPr: services.derived.getWorkoutHighlights(detail.workout.id).prs.length > 0,
        };
      });
    } catch {
      return null; // render the user-safe error state
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, reloadKey, revision]);

  const renderItem = useCallback(
    ({ item }: { item: HistoryEntry }) => (
      <Card>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={
            "Open workout " + item.title + " from " + formatDateTime(item.startedAt) +
            ", " + formatDurationRough(item.durationSeconds) + ", " + String(item.completedSetCount) + " sets"
          }
          onPress={() => router.push("/history/" + item.workoutId)}
          style={styles.row}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.date}>{formatDateTime(item.startedAt)}</Text>
            <Text style={styles.title}>{item.title}</Text>
          </View>
          <View style={styles.statsCol}>
            <Text style={styles.duration}>{formatDurationRough(item.durationSeconds)}</Text>
            <Text style={styles.sets}>{String(item.completedSetCount) + " sets"}</Text>
          </View>
          {item.hasPr ? (
            <View style={styles.prBadge}>
              <Text style={styles.prBadgeText}>PR</Text>
            </View>
          ) : null}
        </Pressable>
      </Card>
    ),
    [router],
  );

  if (entries === null) {
    return (
      <Screen>
        <Text style={styles.kicker}>HISTORY</Text>
        <InlineError
          message={"We couldn't load your workout history. Your data is safe - try again."}
          retryLabel="TRY AGAIN"
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.kicker}>HISTORY</Text>
      <Text style={styles.pageTitle}>Workouts</Text>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.workoutId}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={entries.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="barbell-outline"
            title="No workouts yet"
            description="Your completed workouts will appear here."
            ctaLabel="START A WORKOUT"
            onCta={() => router.push("/(tabs)/workout")}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: { ...type.label, color: colors.accent, letterSpacing: 1.2 },
  pageTitle: { ...type.pageTitle, color: colors.text, marginBottom: space[2] },
  list: { gap: space[2], paddingBottom: space[8] },
  emptyList: { flexGrow: 1, justifyContent: "center" },
  separator: { height: space[2] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3] },
  date: { ...type.caption, color: colors.textMuted },
  title: { ...type.cardTitle, color: colors.text },
  statsCol: { alignItems: "flex-end" },
  duration: { ...type.metricSmall, color: colors.text, fontVariant: ["tabular-nums"], fontSize: 16 },
  sets: { ...type.caption, color: colors.textMuted },
  prBadge: {
    backgroundColor: colors.accentSubtle,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  prBadgeText: { ...type.label, color: colors.accent },
});
