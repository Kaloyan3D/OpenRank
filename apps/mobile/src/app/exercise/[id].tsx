import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import catalogJson from "@openrank/exercise-catalog/catalog.v1.json";
import type { CatalogV1 } from "@openrank/exercise-catalog";
import { aliasesForExercise, getExerciseBySlug } from "@openrank/exercise-catalog";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Exercise details (spec section 49 route exercise/[id]): canonical fields,
 * muscles, instruction steps and alias names. Media is manifest-only until
 * the optional media pack ships (spec section 8).
 */
const catalog = catalogJson as unknown as CatalogV1;

export default function ExerciseDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const slug = typeof params.id === "string" ? decodeURIComponent(params.id) : "";
  const exercise = getExerciseBySlug(catalog, slug);

  if (!exercise) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Exercise not found</Text>
        <Text style={styles.meta}>{slug}</Text>
      </View>
    );
  }

  const aliases = aliasesForExercise(catalog, exercise.id)
    .map((a) => a.alias)
    .filter((alias) => alias !== exercise.name)
    .slice(0, 8);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{exercise.name}</Text>
      <View style={styles.badgeRow}>
        <Badge label={exercise.category} />
        {exercise.mechanic ? <Badge label={exercise.mechanic} /> : null}
        {exercise.force ? <Badge label={exercise.force} /> : null}
        <Badge label={exercise.equipment ?? "bodyweight"} />
        <Badge label={exercise.trackingType.replace(/_/g, " ")} />
        {exercise.ranking.eligible && exercise.ranking.group ? (
          <Badge label={"rank: " + exercise.ranking.group} />
        ) : null}
      </View>

      <Text style={styles.section}>Muscles</Text>
      <Text style={styles.body}>
        Primary: {exercise.primaryMuscles.join(", ") || "none"}
        {exercise.secondaryMuscles.length > 0
          ? "\nSecondary: " + exercise.secondaryMuscles.join(", ")
          : ""}
      </Text>

      <Text style={styles.section}>How to</Text>
      {exercise.instructions.length === 0 ? (
        <Text style={styles.meta}>No instructions in the source dataset.</Text>
      ) : (
        exercise.instructions.map((step, i) => (
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
        {exercise.images.length > 0
          ? String(exercise.images.length) + " images available via the media pack (not bundled)."
          : "No images in the source dataset."}
      </Text>
      <Text style={styles.source}>Source: {exercise.source} ({exercise.sourceId})</Text>
    </View>
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
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.xs },
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
