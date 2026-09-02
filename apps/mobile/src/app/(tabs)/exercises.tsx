import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Exercise, MajorGroup, TrackingType } from "@openrank/domain";
import { MAJOR_GROUPS } from "@openrank/exercise-catalog";
import { useRepos } from "../../db/DatabaseProvider";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Exercise catalog browser (Phase 3): offline search + filters served from
 * SQLite (the seeded catalog), through the repository layer. This screen is
 * display only; persistence lives in packages/database (spec sections 2, 44).
 */
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
  const repos = useRepos();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<MajorGroup | null>(null);
  const [tracking, setTracking] = useState<TrackingType | null>(null);

  const results: Exercise[] = useMemo(
    () =>
      repos.exercise.search({
        query,
        majorGroup: group,
        trackingType: tracking,
        limit: 200,
      }),
    [repos, query, group, tracking],
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
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
            onPress={() => router.push("/exercise/" + encodeURIComponent(item.slug))}
          >
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>
              {[item.equipment ?? "bodyweight", rankLabel(item)].filter(Boolean).join(" - ")}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

/** Short rank-participation label from the ranking-support metadata. */
function rankLabel(exercise: Exercise): string | null {
  if (exercise.rankingEligibility === "unsupported" || !exercise.rankingGroup) return null;
  return exercise.rankingEligibility === "provisional"
    ? "rank (provisional): " + exercise.rankingGroup
    : "rank: " + exercise.rankingGroup;
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
  container: { flex: 1, backgroundColor: colors.bg, padding: space.md },
  search: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginBottom: space.sm,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginBottom: space.sm },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.textMuted,
    paddingHorizontal: space.sm,
    paddingVertical: space[1],
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  chipText: { ...type.caption, color: colors.textMuted },
  chipTextActive: { color: colors.accent },
  count: { ...type.caption, color: colors.textMuted, marginBottom: space.xs },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.sm,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  name: { ...type.body, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
});
