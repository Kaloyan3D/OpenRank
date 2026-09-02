import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useRepos } from "../../db/DatabaseProvider";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Exercise details (spec section 49 route exercise/[id]): canonical fields,
 * muscles, instruction steps, alias names and media metadata - all served
 * from SQLite through the repository layer (Phase 3).
 */
export default function ExerciseDetailScreen() {
  const repos = useRepos();
  const params = useLocalSearchParams<{ id: string }>();
  const slug = typeof params.id === "string" ? decodeURIComponent(params.id) : "";

  const bySlug = repos.exercise.findBySlug(slug);
  const detail = bySlug ? repos.exercise.getDetail(bySlug.id) : null;

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

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>{exercise.name}</Text>
      <View style={styles.badgeRow}>
        <Badge label={exercise.category} />
        {exercise.mechanic ? <Badge label={exercise.mechanic} /> : null}
        {exercise.force ? <Badge label={exercise.force} /> : null}
        <Badge label={exercise.equipment ?? "bodyweight"} />
        <Badge label={exercise.trackingType.replace(/_/g, " ")} />
        {exercise.rankingEligibility !== "unsupported" && exercise.rankingGroup ? (
          <Badge
            label={
              exercise.rankingEligibility === "provisional"
                ? "rank (provisional): " + exercise.rankingGroup
                : "rank: " + exercise.rankingGroup
            }
          />
        ) : null}
      </View>

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
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
  badge: {
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeText: { color: colors.accent, fontSize: 12 },
  section: { ...typography.body, color: colors.accent, marginTop: spacing.md, fontWeight: "700" },
  body: { ...typography.body, color: colors.text },
  meta: { ...typography.caption },
  source: { ...typography.caption, marginTop: spacing.lg },
});