import { useCallback, useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useCanonicalRevision } from "../../local-data/useCanonicalRevision";
import { formatDayShort, formatDurationRough } from "../../ui/format";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineError } from "../../components/ui/InlineError";
import { colors } from "../../design/colors";
import { rankColor } from "../../design/rank-colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * History (Phase 8.2B pass 2, guide section 17): a clean activity timeline -
 * a premium training journal, not a CRUD list. Sessions group under quiet
 * month headers; each compact card carries date, duration, routine title,
 * completed sets and - only when canonically real - PR / rank-up / bonus
 * highlights as secondary marks. Virtualized via SectionList. No charts,
 * no invented entries; missed and pending sessions live in the schedule,
 * never fabricated here. Empty state is intentional and honest.
 */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

interface HistoryEntry {
  workoutId: string;
  startedAt: string;
  logicalTrainingDate: string;
  title: string;
  durationSeconds: number;
  completedSetCount: number;
  hasPr: boolean;
  rankUpTier: string | null;
  isBonus: boolean;
}

interface HistorySection {
  key: string;
  title: string;
  count: number;
  data: HistoryEntry[];
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

  const sections = useMemo<HistorySection[] | null>(() => {
    try {
      if (!profile) return [];
      const entries: HistoryEntry[] = services.workout.listHistory(profile.id).map((detail) => {
        const summary = services.workout.getSummary(detail.workout.id);
        const highlights = services.derived.getWorkoutHighlights(detail.workout.id);
        // Canonical bonus semantics: a completed workout with no linked
        // scheduled session was extra training; it never moves the plan.
        const linked = repos.scheduledSessions.forWorkout(detail.workout.id);
        // Journal title: snapshot title, else the routine behind the linked
        // session, else the established product label for routine-less
        // training (routine-started workouts always carry a snapshot title).
        const linkedRoutineName =
          linked?.routineId ? repos.routine.getById(linked.routineId)?.routine.name ?? null : null;
        // Note: the ternary is hoisted to its own binding - nesting a
        // conditional expression that itself contains a nullish coalesce
        // inside a nullish chain trips a false TS2871 in TypeScript 6.0.x.
        const title = detail.workout.title ?? linkedRoutineName ?? "Freestyle";
        return {
          workoutId: detail.workout.id,
          startedAt: detail.workout.startedAt,
          logicalTrainingDate: detail.workout.logicalTrainingDate,
          title,
          durationSeconds: summary.durationSeconds,
          completedSetCount: summary.completedSetCount,
          hasPr: highlights.prs.length > 0,
          rankUpTier: highlights.rankUps[0]?.toTier ?? null,
          isBonus: linked === null,
        };
      });
      const byMonth = new Map<string, HistoryEntry[]>();
      for (const e of entries) {
        const key = e.logicalTrainingDate.slice(0, 7);
        const bucket = byMonth.get(key);
        if (bucket) bucket.push(e);
        else byMonth.set(key, [e]);
      }
      return Array.from(byMonth.entries()).map(([key, data]) => {
        const year = key.slice(0, 4);
        const monthIndex = Number(key.slice(5, 7)) - 1;
        const monthName = MONTH_NAMES[monthIndex] ?? key;
        return { key, title: monthName + " " + year, count: data.length, data };
      });
    } catch {
      return null; // render the user-safe error state
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, reloadKey, revision]);

  const renderItem = useCallback(
    ({ item }: { item: HistoryEntry }) => (
      <Card style={styles.card}>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={
            "Open workout " + item.title + " from " + formatDayShort(item.startedAt) +
            ", " + formatDurationRough(item.durationSeconds) + ", " + String(item.completedSetCount) + " sets" +
            (item.isBonus ? ", bonus session" : "")
          }
          onPress={() => router.push("/history/" + item.workoutId)}
          style={styles.row}
        >
          <View style={styles.mainCol}>
            <Text style={styles.date}>{formatDayShort(item.startedAt)}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <View style={styles.statsCol}>
            <Text style={styles.duration}>{formatDurationRough(item.durationSeconds)}</Text>
            <Text style={styles.sets}>
              {item.completedSetCount === 1 ? "1 set" : String(item.completedSetCount) + " sets"}
            </Text>
          </View>
        </Pressable>
        {item.hasPr || item.rankUpTier != null || item.isBonus ? (
          <View style={styles.achievementRow}>
            {item.rankUpTier != null ? <Badge label="RANK UP" color={rankColor(item.rankUpTier)} /> : null}
            {item.hasPr ? <Badge label="PR" color={colors.accent} /> : null}
            {item.isBonus ? <Badge label="BONUS" color={colors.textSecondary} /> : null}
          </View>
        ) : null}
      </Card>
    ),
    [router],
  );

  if (sections === null) {
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
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.workoutId}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View style={styles.monthHeader}>
            <Text style={styles.monthTitle}>{section.title}</Text>
            <Text style={styles.monthCount}>{section.count + (section.count === 1 ? " session" : " sessions")}</Text>
          </View>
        )}
        contentContainerStyle={sections.length === 0 ? styles.emptyList : styles.list}
        stickySectionHeadersEnabled={false}
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
  list: { paddingBottom: space[12] },
  emptyList: { flexGrow: 1, justifyContent: "center" },
  monthHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: space[3],
    marginBottom: space[2],
  },
  monthTitle: { ...type.label, color: colors.textSecondary, letterSpacing: 1.2 },
  monthCount: { ...type.caption, color: colors.textMuted },
  card: { paddingVertical: space[3], marginBottom: space[2] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3] },
  mainCol: { flex: 1, gap: 2 },
  statsCol: { alignItems: "flex-end", gap: 2 },
  date: { ...type.caption, color: colors.textSecondary },
  duration: { ...type.metricSmall, color: colors.text, fontVariant: ["tabular-nums"], fontSize: 16 },
  title: { ...type.cardTitle, color: colors.text },
  sets: { ...type.caption, color: colors.textMuted },
  achievementRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space[2] },
});
