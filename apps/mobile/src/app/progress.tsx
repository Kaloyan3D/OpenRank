import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native";
import { useRouter } from "expo-router";
import { GROUPS } from "@openrank/ranking-core";
import type { GroupKey } from "@openrank/ranking-core";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { useUnits } from "../ui/units";
import { formatWeight } from "../ui/format";
import { colors, spacing, typography } from "../theme/tokens";
import { BarChart } from "../features/charts/BarChart";
import { AnimatedProgress } from "../ui/AnimatedProgress";
import { PressableScale } from "../ui/PressableScale";

/**
 * Progress hub (Phase 8): the analytics home. Weekly training activity,
 * bodyweight history and the strength-profile overview with per-group rank
 * timelines. Every chart reads an AnalyticsService projection - the screen
 * computes nothing and never touches SQL.
 */
export default function ProgressScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  const profile = repos.profile.getDefault();

  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Internal state error - the local profile is missing. Restart the app to recover.</Text>
      </View>
    );
  }

  const buckets = services.analytics.weeklyActivity(profile.id, 12);
  const bodyweight = services.analytics.bodyweightSeries(profile.id).slice(-12);
  const summary = services.analytics.strengthProfileSummary(
    profile.id,
    new Map((Object.keys(GROUPS) as GroupKey[]).map((k) => [k, GROUPS[k].label])),
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>PROGRESS</Text>
      <Text style={styles.title}>Your training over time</Text>
      <Text style={styles.muted}>
        Everything here is recalculated from your logged workouts - nothing is
        uploaded, nothing is estimated beyond the published rank formulas.
      </Text>

      <Text style={styles.section}>Weekly activity</Text>
      <BarChart
        points={buckets.map((b) => ({
          label: b.weekStart.slice(5).replace("-", "/"),
          value: b.workouts,
          accessibilityLabel:
            "Week of " + b.weekStart + ": " + String(b.workouts) + " completed workouts, volume " +
            formatWeight(b.volumeKg, units.weightLabel),
        }))}
        unitLabel="Completed workouts per ISO week (last 12 weeks)"
        emptyText="Finish workouts to fill your activity chart."
      />

      <Text style={styles.section}>Bodyweight history</Text>
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

      <Text style={styles.section}>Strength profile</Text>
      {summary.length === 0 ? (
        <Text style={styles.muted}>
          Finish workouts with eligible exercises (and add bodyweight) to earn
          muscle-group ranks.
        </Text>
      ) : (
        summary.map((g) => (
          <PressableScale
            key={g.key}
            style={styles.groupCard}
            accessibilityLabel={"Open " + g.label + " rank history"}
            onPress={() => router.push("/muscle/" + g.key)}
          >
            <View style={styles.groupRow}>
              <Text style={styles.groupLabel}>{g.label}</Text>
              <Text style={styles.groupTier}>
                {g.tierName ? g.tierName + (g.division ? " " + g.division : "") : "No rank yet"}
              </Text>
            </View>
            {g.progress != null ? <AnimatedProgress value={g.progress} /> : null}
            <Text style={styles.groupMeta}>
              {(g.score != null ? "score " + g.score.toFixed(3) : "score -") +
                " - " + String(g.snapshotCount) + " rank updates recorded"}
            </Text>
          </PressableScale>
        ))
      )}

      <Pressable
        style={styles.linkCard}
        accessibilityLabel="Open achievements"
        onPress={() => router.push("/achievements")}
      >
        <Text style={styles.linkText}>Achievements - see what you have unlocked</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: 24 },
  kicker: { ...typography.caption, color: colors.accent, fontWeight: "700", letterSpacing: 1.5 },
  title: { ...typography.title, color: colors.text },
  muted: { ...typography.caption, color: colors.textMuted },
  section: { ...typography.title, color: colors.text, fontSize: 18, marginTop: spacing.sm },
  groupCard: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: 6 },
  groupRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  groupLabel: { ...typography.body, color: colors.text, fontWeight: "700", textTransform: "uppercase" },
  groupTier: { ...typography.body, color: colors.accent, fontWeight: "700" },
  groupMeta: { ...typography.caption, color: colors.textMuted, fontVariant: ["tabular-nums"] },
  linkCard: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginTop: spacing.xs },
  linkText: { ...typography.body, color: colors.accent, fontWeight: "700" },
});
