import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import catalogJson from "@openrank/exercise-catalog/catalog.v1.json";
import type { CatalogV1, MajorGroup, TrackingType } from "@openrank/exercise-catalog";
import { MAJOR_GROUPS, searchExercises } from "@openrank/exercise-catalog";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Exercise catalog browser (Phase 2): offline search + filters over the
 * bundled catalog. All logic lives in @openrank/exercise-catalog; this screen
 * is display only (spec section 44).
 */
const catalog = catalogJson as unknown as CatalogV1;

const GROUP_LABELS: Record<MajorGroup, string> = {
  legs: "Legs",
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  arms: "Arms",
  core: "Core",
};

const TRACKING_LABELS: Partial<Record<TrackingType, string>> = {
  weight_reps: "Weight",
  bodyweight_reps: "Bodyweight",
  bodyweight_weighted: "Weighted BW",
  bodyweight_assisted: "Assisted",
};

export default function ExercisesScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<MajorGroup | null>(null);
  const [tracking, setTracking] = useState<TrackingType | null>(null);

  const results = useMemo(
    () =>
      searchExercises(catalog, {
        query,
        majorGroup: group,
        trackingType: tracking,
        rankEligibleOnly: false,
      }).slice(0, 200),
    [query, group, tracking],
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search exercises..."
        placeholderTextColor={colors.textMuted}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
      />
      <View style={styles.chipsRow}>
        <FilterChip
          label="All"
          active={group === null && tracking === null}
          onPress={() => {
            setGroup(null);
            setTracking(null);
          }}
        />
        {MAJOR_GROUPS.map((g) => (
          <FilterChip
            key={g}
            label={GROUP_LABELS[g]}
            active={group === g}
            onPress={() => setGroup(group === g ? null : g)}
          />
        ))}
        {(Object.keys(TRACKING_LABELS) as TrackingType[]).map((t) => (
          <FilterChip
            key={t}
            label={TRACKING_LABELS[t] ?? t}
            active={tracking === t}
            onPress={() => setTracking(tracking === t ? null : t)}
          />
        ))}
      </View>
      <Text style={styles.count}>
        {String(results.length)} exercise{results.length === 1 ? "" : "s"}
      </Text>
      <FlatList
        data={results}
        keyExtractor={(item) => item.exercise.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push("/exercise/" + encodeURIComponent(item.exercise.slug))}
          >
            <Text style={styles.name}>{item.exercise.name}</Text>
            <Text style={styles.meta}>
              {[item.exercise.equipment ?? "bodyweight", ...item.exercise.primaryMuscles].join(" - ")}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function FilterChip(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[styles.chip, props.active ? styles.chipActive : null]}
    >
      <Text style={[styles.chipText, props.active ? styles.chipTextActive : null]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  search: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextActive: { color: colors.accent },
  count: { ...typography.caption, marginBottom: spacing.xs },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  name: { ...typography.body, color: colors.text },
  meta: { ...typography.caption, marginTop: 2 },
});