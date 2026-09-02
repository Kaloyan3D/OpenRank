import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useUnits } from "../../ui/units";
import { formatDateTime, formatProgressPercent, formatRankLabel } from "../../ui/format";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Ranks tab (Phase 5, spec Y): the Strength Profile - exactly the six muscle
 * groups of the ranking engine, each with tier, division and within-tier
 * progress. There is NO overall rank (the engine's overall ranking is
 * disabled and none is shown anywhere). Recent rank changes + a bodyweight
 * CTA complete the screen. Pure read model: recompute per render.
 */
export default function RanksScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  void repos;

  const profile = useRepos().profile.getDefault();
  const view = profile ? services.derived.getStrengthProfile(profile.id) : null;
  const recent = profile ? services.derived.recentRankEvents(profile.id, 12) : [];

  if (!view) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Create your profile to see your strength ranks.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>STRENGTH PROFILE</Text>
      <Text style={styles.title}>Muscle group ranks</Text>
      {!view.hasBodyweight ? (
        <Pressable style={styles.cta} onPress={() => router.push("/(tabs)/profile")}>
          <Text style={styles.ctaText}>Add bodyweight to calculate strength ranks.</Text>
        </Pressable>
      ) : (
        <Text style={styles.meta}>
          {"Bodyweight " +
            (view.bodyweightKg != null ? units.toDisplay(view.bodyweightKg) + " " + units.weightLabel : "-") +
            (view.bodyweightMeasuredAt ? " - measured " + formatDateTime(view.bodyweightMeasuredAt) : "")}
        </Text>
      )}

      {view.groups.map((g) => (
        <Pressable key={g.key} style={styles.card} onPress={() => router.push("/muscle/" + g.key)}>
          <View style={styles.cardHeader}>
            <Text style={styles.groupLabel}>{g.label}</Text>
            {g.tierName ? (
              <Text style={styles.tier}>{formatRankLabel(g.tierName, g.division)}</Text>
            ) : (
              <Text style={styles.tierMuted}>No rank yet</Text>
            )}
          </View>
          {g.tierName && g.progress != null ? (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(2, Math.round((g.progress ?? 0) * 100))}%` as const }]} />
            </View>
          ) : null}
          <Text style={styles.meta}>
            {g.tierName && g.progress != null
              ? formatProgressPercent(g.progress) + " to next division - score " + (g.score != null ? g.score.toFixed(3) : "-")
              : view.hasBodyweight
                ? "Log a ranked exercise to place this group."
                : "Strength ranks need a bodyweight entry."}
          </Text>
        </Pressable>
      ))}

      <Text style={styles.section}>Recent rank changes</Text>
      {recent.length === 0 ? (
        <Text style={styles.meta}>No rank changes yet. Finish workouts to climb.</Text>
      ) : (
        recent.map((e) => (
          <View key={e.id} style={styles.eventRow}>
            <Text style={[styles.eventArrow, { color: e.direction === "up" ? colors.success : colors.textMuted }]}>
              {e.direction === "up" ? "^" : "v"}
            </Text>
            <Text style={styles.eventText}>
              {formatRankLabel(e.toTier, e.toDivision) +
                " - " +
                (e.scopeType === "muscle" ? muscleLabel(e.scopeKey) : "exercise") +
                " - " +
                formatDateTime(e.createdAt)}
            </Text>
          </View>
        ))
      )}

      <Text style={styles.note}>
        Ranks use the hevy-ranks-compatible-v1 engine: reference-lift strength
        per group, top-3 weighting, no overall score. Ranks are derived data
        and rebuild from your workout history at any time.
      </Text>
    </ScrollView>
  );
}

const MUSCLE_LABELS: Record<string, string> = {
  legs: "Legs",
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  arms: "Arms",
  core: "Core",
};

function muscleLabel(key: string): string {
  return MUSCLE_LABELS[key] ?? key;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  title: { ...typography.title, color: colors.text },
  meta: { ...typography.caption },
  muted: { ...typography.caption, color: colors.textMuted },
  cta: { backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 1, borderRadius: 10, padding: spacing.md },
  ctaText: { color: colors.accent, fontWeight: "700" },
  card: { backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, gap: spacing.xs },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  groupLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  tier: { color: colors.accent, fontWeight: "700" },
  tierMuted: { color: colors.textMuted, fontWeight: "600" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.background, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  section: { ...typography.title, color: colors.text, fontSize: 18, marginTop: spacing.sm },
  eventRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  eventArrow: { fontWeight: "800", width: 14 },
  eventText: { ...typography.caption, color: colors.text, flex: 1, flexShrink: 1 },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
});