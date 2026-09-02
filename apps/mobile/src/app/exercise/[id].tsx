import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useUnits } from "../../ui/units";
import { formatDateTime, formatProgressPercent, formatRankLabel, formatWeight } from "../../ui/format";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Exercise details (spec section 49 route exercise/[id], Phase 5 upgrade):
 * canonical fields + muscles + instructions (Phase 3) and the derived
 * RANKING view (spec AA-AC): current rank with division + progress, the
 * next-rank target (an estimate, not advice), personal records, PR history
 * and rank history. Provisional ranks carry an explicit PROVISIONAL label;
 * unsupported exercises get honest "not ranked" messaging - no fabricated
 * numbers, no invented formulas.
 */
export default function ExerciseDetailScreen() {
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  const params = useLocalSearchParams<{ id: string }>();
  const slug = typeof params.id === "string" ? decodeURIComponent(params.id) : "";

  const bySlug = repos.exercise.findBySlug(slug);
  const detail = bySlug ? repos.exercise.getDetail(bySlug.id) : null;
  const profile = repos.profile.getDefault();

  if (!detail) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Exercise not found</Text>
        <Text style={styles.meta}>{slug}</Text>
      </View>
    );
  }

  const { exercise } = detail;
  const aliases = detail.aliases
    .map((a) => a.alias)
    .filter((alias) => alias !== exercise.name)
    .slice(0, 8);
  const ranking = profile ? services.derived.getExerciseRanking(profile.id, exercise.id) : null;
  const s = ranking?.snapshot ?? null;

  const prLine = (recordType: string, qualifierKey: string): string => {
    switch (recordType) {
      case "max_weight":
        return "Max weight";
      case "max_e1rm":
        return "Best estimated 1RM";
      case "max_set_volume":
        return "Best set volume";
      case "max_reps_at_weight":
        return "Most reps @ " + qualifierLabel(qualifierKey, units.weightLabel);
      default:
        return recordType;
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>{exercise.name}</Text>
      <View style={styles.badgeRow}>
        <Badge label={exercise.category} />
        {exercise.mechanic ? <Badge label={exercise.mechanic} /> : null}
        {exercise.force ? <Badge label={exercise.force} /> : null}
        <Badge label={exercise.equipment ?? "bodyweight"} />
        <Badge label={exercise.trackingType.replace(/_/g, " ")} />
      </View>

      {ranking && exercise.rankingEligibility === "unsupported" ? (
        <>
          <Text style={styles.section}>Ranking</Text>
          <Text style={styles.meta}>
            This exercise is not part of the ranked strength catalog, so it has
            no rank. Your sets still count toward personal records below.
          </Text>
        </>
      ) : ranking ? (
        <>
          <Text style={styles.section}>Ranking</Text>
          {s ? (
            <>
              <View style={styles.badgeRow}>
                <Text style={styles.tierBadge}>{formatRankLabel(s.tierName, s.division)}</Text>
                {ranking.provisional ? <Badge label="PROVISIONAL" /> : null}
              </View>
              {s.progress != null ? (
                <Text style={styles.meta}>
                  {formatProgressPercent(s.progress) + " to next division - score " + s.score.toFixed(3)}
                </Text>
              ) : (
                <Text style={styles.meta}>Highest rank reached.</Text>
              )}
              {ranking.nextTarget ? (
                <Text style={styles.meta}>
                  {"Next rank (" + ranking.nextTarget.targetTier + "): about " +
                    formatWeight(ranking.nextTarget.required1RM, "kg") + " of 1RM on this exercise's reference" +
                    (ranking.nextTarget.exampleTargetWeight != null
                      ? " - e.g. " + formatWeight(ranking.nextTarget.exampleTargetWeight, units.weightLabel) +
                        " x " + String(ranking.nextTarget.exampleReps)
                      : "") +
                    ". An estimate, not a prescription."}
                </Text>
              ) : null}
              {ranking.provisional ? (
                <Text style={styles.meta}>
                  This exercise's rank is provisional: its classification needs
                  review, so it never influences muscle group ranks.
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.meta}>{unrankedReason(ranking.unavailableReason)}</Text>
          )}

          {ranking.rankEvents.length > 0 ? (
            <>
              <Text style={styles.subsection}>Rank history</Text>
              {ranking.rankEvents.map((e) => (
                <Text key={e.id} style={styles.meta}>
                  {(e.direction === "up" ? "^ " : "v ") +
                    formatRankLabel(e.toTier, e.toDivision) +
                    " - " +
                    formatDateTime(e.createdAt)}
                </Text>
              ))}
            </>
          ) : null}
        </>
      ) : null}

      {ranking && ranking.records.length > 0 ? (
        <>
          <Text style={styles.section}>Personal records</Text>
          {ranking.records.map((r) => (
            <View key={r.id + r.recordType + r.qualifierKey} style={styles.prRow}>
              <Text style={styles.body}>{prLine(r.recordType, r.qualifierKey)}</Text>
              <Text style={styles.prValue}>
                {formatPrValue(r.recordType, r.value, r.sourceReps, units.weightLabel)}
              </Text>
            </View>
          ))}
          {ranking.prEvents.length > 0 ? (
            <>
              <Text style={styles.subsection}>PR history</Text>
              {ranking.prEvents.map((e) => (
                <Text key={e.id} style={styles.meta}>
                  {formatPrValue(e.recordType, e.value, null, units.weightLabel) +
                    " - " +
                    (e.previousValue == null ? "first record" : "up from " + formatPrValue(e.recordType, e.previousValue, null, units.weightLabel)) +
                    " - " +
                    formatDateTime(e.achievedAt)}
                </Text>
              ))}
            </>
          ) : null}
        </>
      ) : null}

      <Text style={styles.section}>Muscles</Text>
      <Text style={styles.body}>
        {"Primary: " + (detail.primaryMuscles.join(", ") || "none")}
        {detail.secondaryMuscles.length > 0
          ? "\nSecondary: " + detail.secondaryMuscles.join(", ")
          : ""}
      </Text>

      <Text style={styles.section}>How to</Text>
      {detail.instructions.length === 0 ? (
        <Text style={styles.meta}>No instructions in the source dataset.</Text>
      ) : (
        detail.instructions.map((step, i) => (
          <Text key={String(i)} style={styles.body}>
            {String(i + 1) + ". " + step}
          </Text>
        ))
      )}

      {aliases.length > 0 ? (
        <>
          <Text style={styles.section}>Also known as</Text>
          <Text style={styles.body}>{aliases.join(", ")}</Text>
        </>
      ) : null}

      <Text style={styles.section}>Media</Text>
      <Text style={styles.meta}>
        {detail.media.length > 0
          ? String(detail.media.length) + " images available via the media pack (not bundled)."
          : "No images in the source dataset."}
      </Text>
      <Text style={styles.source}>
        Source: {exercise.source} ({exercise.sourceId ?? "local"})
      </Text>
    </ScrollView>
  );
}

function qualifierLabel(qualifierKey: string, weightLabel: string): string {
  const kg = Number(qualifierKey.slice(2));
  if (!Number.isFinite(kg)) return qualifierKey;
  return kg === 0 ? "bodyweight" : Math.round(kg * 100) / 100 + " " + weightLabel;
}

function formatPrValue(
  recordType: string,
  value: number,
  reps: number | null,
  weightLabel: string,
): string {
  const rounded = Math.round(value * 100) / 100;
  switch (recordType) {
    case "max_weight":
      return rounded + " " + weightLabel;
    case "max_e1rm":
      return rounded + " kg 1RM";
    case "max_set_volume":
      return rounded + " kg x reps";
    case "max_reps_at_weight":
      return String(Math.round(value)) + " reps" + (reps != null ? "" : "");
    default:
      return String(rounded);
  }
}

function unrankedReason(reason: string | null): string {
  switch (reason) {
    case "no_bodyweight":
      return "Add a bodyweight entry to calculate strength ranks for this exercise.";
    case "no_qualifying_data":
      return "Log this exercise in completed workouts to earn a rank.";
    case "unsupported":
      return "This exercise is not part of the ranked strength catalog.";
    case "ambiguous_title":
      return "Multiple catalog entries share this name; ranking is paused for safety.";
    default:
      return "No rank yet.";
  }
}

function Badge(props: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, gap: spacing.xs },
  title: { ...typography.title, color: colors.text, marginBottom: spacing.sm },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm, alignItems: "center" },
  badge: {
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeText: { color: colors.accent, fontSize: 12 },
  tierBadge: {
    backgroundColor: colors.surface,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    color: colors.accent,
    fontWeight: "700",
  },
  section: { ...typography.body, color: colors.accent, marginTop: spacing.md, fontWeight: "700" },
  subsection: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, fontWeight: "700" },
  body: { ...typography.body, color: colors.text },
  meta: { ...typography.caption },
  prRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  prValue: { color: colors.accent, fontWeight: "700", fontVariant: ["tabular-nums"] },
  source: { ...typography.caption, marginTop: spacing.lg },
});
