import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { GROUPS } from "@openrank/ranking-core";
import type { GroupKey } from "@openrank/ranking-core";
import { useRepos } from "../../db/DatabaseProvider";
import { TierTimeline } from "../../features/charts/TierTimeline";
import { useServices } from "../../services/ServicesProvider";
import { formatDateTime, formatProgressPercent, formatRankLabel } from "../../ui/format";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Muscle group detail (Phase 5, spec Z): answers "why am I Diamond III?" -
 * tier/division/progress, the contributing lifts the engine aggregated
 * (used vs excluded with the engine's reason), the next-tier target and the
 * rank history timeline. Everything is engine output; the screen formats it
 * and adds no ranking math.
 */
export default function MuscleDetailScreen() {
  const params = useLocalSearchParams<{ group: string }>();
  const groupKey = typeof params.group === "string" ? params.group : "";
  const repos = useRepos();
  const services = useServices();

  const cfg = GROUPS[groupKey as GroupKey];
  const profile = repos.profile.getDefault();
  if (!cfg || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Unknown muscle group.</Text>
      </View>
    );
  }

  const view = services.derived.getMuscleDetail(profile.id, cfg.key);
  const s = view.snapshot;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>{cfg.label.toUpperCase()}</Text>
      <Text style={styles.title}>{s ? formatRankLabel(s.tierName, s.division) : "No rank yet"}</Text>
      {s ? (
        <>
          <Text style={styles.meta}>
            {formatProgressPercent(s.progress) + " to next division - score " + s.score.toFixed(3)}
          </Text>
          <Text style={styles.meta}>{"Reference lift: " + cfg.ref + " - updated " + formatDateTime(s.calculatedAt)}</Text>
        </>
      ) : (
        <Text style={styles.muted}>
          Finish workouts with eligible exercises in this group (and add bodyweight) to earn a rank.
        </Text>
      )}

      <Text style={styles.section}>How this rank is computed</Text>
      <Text style={styles.body}>
        The engine takes your best estimated 1RM per exercise, divides it by the
        exercise's reference coefficient and your bodyweight, then aggregates
        your top three COMPOUND lifts with weights 100% / 50% / 25%. If no
        compound lift has enough sessions, the best isolation lifts stand in
        (capped at Titan); with fewer than 3 sessions overall the group is
        capped at Platinum.
      </Text>

      {view.contributing.length > 0 ? (
        <>
          <Text style={styles.section}>Contributing lifts</Text>
          {view.contributing.map((lift, i) => (
            <View key={String(lift.title) + "-" + String(i)} style={styles.card}>
              <Text style={styles.liftTitle}>{String(lift.title)}</Text>
              <Text style={styles.meta}>
                {String(lift.role) === "used"
                  ? "counted toward this group"
                  : "not counted - " + String(lift.reason ?? "below the session minimum")}
              </Text>
              <Text style={styles.meta}>
                {"score " + (lift.eqRatio != null ? Number(lift.eqRatio).toFixed(3) : "-") + " - sessions " + String(lift.sessionsCount)}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {view.recommendation ? (
        <>
          <Text style={styles.section}>Next tier target</Text>
          <Text style={styles.body}>
            {"Top lift: " + String(view.recommendation.topLiftTitle ?? "-") +
              " - next tier " + String(view.recommendation.nextTier ?? "-") +
              (view.recommendation.tooFar ? " (still far away)" : "")}
          </Text>
          {typeof view.recommendation.delta1RM === "number" ? (
            <Text style={styles.meta}>
              {"Estimated gap: " + Number(view.recommendation.delta1RM).toFixed(1) + " kg of 1RM on your top lift."}
            </Text>
          ) : null}
        </>
      ) : null}

      <Text style={styles.section}>Rank history</Text>
      <TierTimeline
        points={view.rankHistory.map((snap) => ({
          at: snap.calculatedAt,
          score: snap.score,
          tierIndex: snap.tierIndex,
          tierName: snap.tierName,
          division: snap.division,
          progress: snap.progress,
        }))}
      />
      {view.rankHistory.length === 0 ? (
        <Text style={styles.meta}>No rank history yet.</Text>
      ) : (
        view.rankHistory.map((snap) => (
          <View key={snap.id} style={styles.eventRow}>
            <Text style={styles.eventText}>
              {formatRankLabel(snap.tierName, snap.division) + " - " + formatDateTime(snap.calculatedAt)}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  title: { ...typography.title, color: colors.text },
  meta: { ...typography.caption },
  muted: { ...typography.caption, color: colors.textMuted },
  section: { ...typography.title, color: colors.text, fontSize: 18, marginTop: spacing.sm },
  body: { ...typography.caption, color: colors.text, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, gap: 2 },
  liftTitle: { color: colors.text, fontWeight: "700" },
  eventRow: { paddingVertical: 2 },
  eventText: { ...typography.caption, color: colors.text },
});
