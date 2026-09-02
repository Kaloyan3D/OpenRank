import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { GROUPS } from "@openrank/ranking-core";
import type { GroupKey } from "@openrank/ranking-core";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { useUnits } from "../ui/units";
import { formatWeight } from "../ui/format";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { RankBadge } from "../components/ui/RankBadge";
import { EmptyState } from "../components/ui/EmptyState";
import { BarChart } from "../features/charts/BarChart";
import { AnimatedProgress } from "../ui/AnimatedProgress";
import { PressableScale } from "../ui/PressableScale";
import { RANGE_OPTIONS, rangeStartIso, rangeToWeeks, type ProgressRange } from "../features/progress/ranges";
import { rankColor } from "../design/rank-colors";
import { colors } from "../design/colors";
import { space } from "../design/spacing";
import { type } from "../design/typography";

/**
 * Progress hub (Phase 8 analytics; Phase 8.1 approved layout, spec 33-35):
 * range chips (amber selected) drive WORKOUTS PER WEEK and VOLUME PER WEEK
 * bars; metric cards show PRs, Rank Ups, Longest Streak, Consistency;
 * Training Distribution uses the last 12 sessions (bounded read, honestly
 * labeled); Strength Profile + Bodyweight complete the screen. Every chart
 * reads an AnalyticsService projection - the screen computes nothing and
 * never touches SQL. Textual summaries ride every chart (a11y).
 */
export default function ProgressScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  const [range, setRange] = useState<ProgressRange>("12W");
  const profile = repos.profile.getDefault();

  if (!profile) {
    return (
      <Screen>
        <Text style={styles.muted}>Internal state error - the local profile is missing. Restart the app to recover.</Text>
      </Screen>
    );
  }

  const weeks = rangeToWeeks(range);
  const sinceIso = rangeStartIso(range);
  const buckets = services.analytics.weeklyActivity(profile.id, weeks);
  const bodyweight = services.analytics.bodyweightSeries(profile.id).slice(-weeks);
  const summary = services.analytics.strengthProfileSummary(
    profile.id,
    new Map((Object.keys(GROUPS) as GroupKey[]).map((k) => [k, GROUPS[k].label])),
  );
  const prEvents = repos.personalRecords.listEventsForProfile(profile.id, 500).filter((e) => e.achievedAt.slice(0, 10) >= sinceIso);
  const rankUps = services.derived
    .recentRankEvents(profile.id, 500)
    .filter((e) => e.direction === "up" && e.createdAt.slice(0, 10) >= sinceIso);
  const streak = services.streak.getCurrentState(profile.id);
  const activeWeeks = buckets.filter((b) => b.workouts > 0).length;
  const consistency = buckets.length > 0 ? activeWeeks / buckets.length : 0;
  // Bounded distribution read: last 12 sessions (documented deviation).
  const recent = services.workout.listHistory(profile.id).slice(0, 12);
  const distro = new Map<string, number>();
  for (const d of recent) {
    for (const ex of d.exercises) {
      const meta = repos.exercise.findById(ex.workoutExercise.exerciseId);
      const label = meta?.rankingGroup ?? "Other";
      distro.set(label, (distro.get(label) ?? 0) + 1);
    }
  }
  const distroTotal = Array.from(distro.values()).reduce((a, b) => a + b, 0);
  const distroRows = Array.from(distro.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>PROGRESS</Text>
        <Text style={styles.pageTitle}>Your training over time</Text>
        <Text style={styles.muted}>
          Everything here is recalculated from your logged workouts - nothing is uploaded, nothing is estimated beyond
          the published rank formulas.
        </Text>

        <View style={styles.rangeRow}>
          {RANGE_OPTIONS.map((r) => (
            <Chip
              key={r}
              label={r}
              selected={range === r}
              onPress={() => setRange(r)}
              accessibilityLabel={"Show last " + r}
            />
          ))}
        </View>

        <Text style={styles.section}>WORKOUTS PER WEEK</Text>
        <BarChart
          points={buckets.map((b) => ({
            label: b.weekStart.slice(5).replace("-", "/"),
            value: b.workouts,
            accessibilityLabel:
              "Week of " + b.weekStart + ": " + String(b.workouts) + " completed workouts, volume " +
              formatWeight(b.volumeKg, units.weightLabel),
          }))}
          unitLabel={"Completed workouts per ISO week (last " + String(weeks) + " weeks)"}
          emptyText="Finish workouts to fill your activity chart."
        />

        <Text style={styles.section}>VOLUME PER WEEK</Text>
        <BarChart
          points={buckets.map((b) => ({
            label: b.weekStart.slice(5).replace("-", "/"),
            value: b.volumeKg,
            accessibilityLabel: "Week of " + b.weekStart + ": volume " + formatWeight(b.volumeKg, units.weightLabel),
          }))}
          unitLabel={"Loaded volume per ISO week (" + units.weightLabel + ", last " + String(weeks) + " weeks)"}
          emptyText="Volume appears once you log weighted sets."
        />

        <View style={styles.metricRow}>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{String(prEvents.length)}</Text>
            <Text style={styles.metricLabel}>PRs</Text>
          </Card>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{String(rankUps.length)}</Text>
            <Text style={styles.metricLabel}>Rank Ups</Text>
          </Card>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{String(streak.cache.bestStreak)}</Text>
            <Text style={styles.metricLabel}>Longest Streak</Text>
          </Card>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{String(Math.round(consistency * 100)) + "%"}</Text>
            <Text style={styles.metricLabel}>Consistency</Text>
          </Card>
        </View>

        <Text style={styles.section}>TRAINING DISTRIBUTION</Text>
        <Card>
          {distroRows.length === 0 ? (
            <Text style={styles.muted}>No sessions yet.</Text>
          ) : (
            distroRows.map(([label, count]) => (
              <View key={label} style={styles.distroRow}>
                <Text style={styles.distroLabel}>{label === "Other" ? "Other / ungrouped" : label}</Text>
                <View style={styles.distroBarWrap}>
                  <View style={[styles.distroBar, { flex: Math.max(1, count) }]} />
                  <Text style={styles.distroCount}>{String(count) + " of " + String(distroTotal)}</Text>
                </View>
              </View>
            ))
          )}
          <Text style={styles.muted}>Last 12 sessions.</Text>
        </Card>

        <Text style={styles.section}>STRENGTH PROFILE</Text>
        {summary.length === 0 ? (
          <EmptyState
            icon="trending-up-outline"
            title="No ranks yet"
            description="Finish workouts with eligible exercises (and add bodyweight) to earn muscle-group ranks."
          />
        ) : (
          summary.map((g) => (
            <PressableScale
              key={g.key}
              accessibilityRole="button"
              accessibilityLabel={g.label + " rank " + (g.tierName ?? "not ranked") + ". Open rank history."}
              onPress={() => router.push("/muscle/" + g.key)}
            >
              <Card>
                <View style={styles.groupRow}>
                  <Text style={styles.groupLabel}>{g.label}</Text>
                  <RankBadge tierName={g.tierName} division={g.division} size="sm" />
                </View>
                {g.tierName && g.progress != null ? (
                  <AnimatedProgress value={g.progress} fillColor={rankColor(g.tierName)} />
                ) : null}
                <Text style={styles.groupMeta}>
                  {(g.score != null ? "score " + g.score.toFixed(3) : "score -") +
                    " - " + String(g.snapshotCount) + " rank updates recorded"}
                </Text>
              </Card>
            </PressableScale>
          ))
        )}

        <Text style={styles.section}>BODYWEIGHT</Text>
        <BarChart
          points={bodyweight.map((p) => ({
            label: p.at.slice(5, 10),
            value: p.weightKg,
            accessibilityLabel:
              "Bodyweight " + units.toDisplay(p.weightKg) + " " + units.weightLabel + " on " + p.at.slice(0, 10),
          }))}
          unitLabel={"Measurements (" + units.weightLabel + ") - chronological, newest right"}
          emptyText="Add bodyweight on the Profile tab to track it here."
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open achievements"
          onPress={() => router.push("/achievements")}
          style={styles.linkCard}
        >
          <Text style={styles.linkText}>Achievements - see what you have unlocked</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: { ...type.label, color: colors.accent, letterSpacing: 1.2 },
  pageTitle: { ...type.pageTitle, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  rangeRow: { flexDirection: "row", gap: space[2], marginVertical: space[3] },
  section: { ...type.label, color: colors.textSecondary, letterSpacing: 1.2, marginTop: space[4], marginBottom: space[1] },
  metricRow: { flexDirection: "row", gap: space[2], marginTop: space[3] },
  metricCard: { flex: 1, alignItems: "center", gap: 2 },
  metricValue: { ...type.metricSmall, color: colors.text, fontVariant: ["tabular-nums"] },
  metricLabel: { ...type.label, color: colors.textMuted, textTransform: "uppercase" },
  distroRow: { flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1] },
  distroLabel: { ...type.caption, color: colors.text, width: 90, textTransform: "capitalize" },
  distroBarWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: space[2] },
  distroBar: { height: 8, backgroundColor: colors.accentSubtle, borderColor: colors.accent, borderWidth: 1, borderRadius: 999 },
  distroCount: { ...type.caption, color: colors.textMuted },
  groupRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  groupLabel: { ...type.cardTitle, color: colors.text, flex: 1 },
  groupMeta: { ...type.caption, color: colors.textMuted },
  linkCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: space[4],
    marginTop: space[4],
    alignItems: "center",
  },
  linkText: { ...type.caption, color: colors.textSecondary },
});
