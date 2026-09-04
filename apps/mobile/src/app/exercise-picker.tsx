import { useCallback, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Exercise, MajorGroup, TrackingType } from "@openrank/domain";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { useCanonicalRevision } from "../local-data/useCanonicalRevision";
import { Chip } from "../components/ui/Chip";
import { colors } from "../design/colors";
import { radius } from "../design/radii";
import { space } from "../design/spacing";
import { type } from "../design/typography";
import {
  EQUIPMENT_FILTERS,
  equipmentLabel,
  exercisePickerSearchOptions,
  toggleEquipmentFilter,
  type EquipmentFilterState,
} from "../ui/equipment";

/**
 * Exercise picker (Phase 4, task E; Phase 8.2 P0.1 filter correctness;
 * Phase 8.2B visual/correctness pass): offline search + filters over the
 * SQLite repository, shaped per design guide section 26 as a fast local
 * command palette. Ranking support is an indicator only - unsupported and
 * provisional exercises remain fully loggable (ranking != availability).
 * Adding an exercise that is already present asks for confirmation instead
 * of silently creating a duplicate block.
 *
 * Equipment filter semantics (see ui/equipment.ts): the default state is
 * undefined = no equipment filter, so the whole catalog is browsable. null
 * is only ever used as an explicit "No equipment" filter and is never the
 * default. Search runs without a row cap so "All" really means all.
 *
 * 8.2B layout contract: exactly ONE vertical virtualized list owns the
 * scrollable content. Recent and the catalog are sections of that single
 * list; section headers (RECENT, ALL EXERCISES + honest result count) are
 * ordinary rows, so the count never floats over content and no row renders
 * beneath a header. Search + filter chips are stable chrome above the list.
 * The chip row is a single unwrapped horizontal scroll row: chips size to
 * their labels and never wrap into clipped slivers.
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
  bodyweight_weighted: "W. BW",
  bodyweight_assisted: "Assisted",
  reps_only: "Reps",
  duration: "Duration",
  distance_duration: "Distance",
};

/** One row of the single picker list: a section header, the empty hint, or an exercise. */
type PickerRow =
  | { readonly kind: "header"; readonly key: string; readonly title: string; readonly count: number | null }
  | { readonly kind: "empty"; readonly key: string }
  | { readonly kind: "exercise"; readonly key: string; readonly exercise: Exercise };

/** Extends the shared 36dp chip to a 44dp touch target without inflating its visual size. */
const CHIP_HIT_SLOP: { top: number; bottom: number } = { top: 4, bottom: 4 };

export default function ExercisePickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ context?: string; id?: string }>();
  const repos = useRepos();
  const services = useServices();

  const context = params.context === "routine" ? "routine" : "workout";
  const containerId = typeof params.id === "string" ? params.id : "";

  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<MajorGroup | null>(null);
  const [tracking, setTracking] = useState<TrackingType | null>(null);
  // undefined = no equipment filter (All); never initialize to null, which
  // the repository would interpret as "equipment IS NULL" (ui/equipment.ts).
  const [equipment, setEquipment] = useState<EquipmentFilterState>(undefined);
  // Canonical invalidation: any committed mutation (ours included) re-renders
  // this screen so "already added" checks and the recent list stay current.
  useCanonicalRevision();

  const profile = repos.profile.getDefault();
  const results: Exercise[] = useMemo(
    () =>
      repos.exercise.search(
        exercisePickerSearchOptions({ query, group, tracking, equipment }),
      ),
    [repos, query, group, tracking, equipment],
  );

  const recent = useMemo(
    () => (profile && query.trim() === "" ? services.workout.getRecentExercises(profile.id, 6) : []),
    [profile, services, query],
  );

  const alreadyPresent = useCallback(
    (exerciseId: string): boolean => {
      if (context === "workout") {
        const detail = repos.workout.getById(containerId);
        return detail?.exercises.some((e) => e.workoutExercise.exerciseId === exerciseId) ?? false;
      }
      const detail = repos.routine.getById(containerId);
      return detail?.exercises.some((e) => e.exerciseId === exerciseId) ?? false;
    },
    [context, containerId, repos],
  );

  const add = useCallback(
    (exercise: Exercise) => {
      const insert = () => {
        // Canonical mutations flow through the service layer - never the
        // repository directly (docs/REACTIVE_LOCAL_DATA.md).
        if (context === "workout") {
          services.workout.addExercise(containerId, { exerciseId: exercise.id });
        } else {
          services.routine.addExercise(containerId, { exerciseId: exercise.id });
        }
        router.back();
      };
      if (alreadyPresent(exercise.id)) {
        Alert.alert("Already added", "This exercise is already in the list. Add another block anyway?", [
          { text: "Cancel", style: "cancel" },
          { text: "Add anyway", onPress: insert },
        ]);
        return;
      }
      insert();
    },
    [context, containerId, services, router, alreadyPresent],
  );

  // Single-list row model: a bounded Recent section (only when the query is
  // empty and history exists) followed by the catalog section. Headers are
  // ordinary rows, so the count is normal content - never an overlay - and
  // virtualization stays correct during search/filter changes.
  const rows = useMemo<PickerRow[]>(() => {
    const out: PickerRow[] = [];
    if (recent.length > 0 && query.trim() === "") {
      out.push({ kind: "header", key: "recent-header", title: "RECENT", count: null });
      for (const exercise of recent) {
        out.push({ kind: "exercise", key: "recent-" + exercise.id, exercise });
      }
    }
    out.push({ kind: "header", key: "catalog-header", title: "ALL EXERCISES", count: results.length });
    if (results.length === 0) out.push({ kind: "empty", key: "catalog-empty" });
    for (const exercise of results) {
      out.push({ kind: "exercise", key: exercise.id, exercise });
    }
    return out;
  }, [recent, query, results]);

  const keyExtractor = useCallback((row: PickerRow) => row.key, []);

  const renderItem = useCallback(
    ({ item }: { item: PickerRow }) => {
      if (item.kind === "header") {
        return (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{item.title}</Text>
            {item.count !== null ? (
              <Text style={styles.sectionCount}>
                {item.count === 1 ? "1 exercise" : String(item.count) + " exercises"}
              </Text>
            ) : null}
          </View>
        );
      }
      if (item.kind === "empty") {
        return <Text style={styles.empty}>No matching exercises</Text>;
      }
      const exercise = item.exercise;
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={"Add " + exercise.name}
          onPress={() => add(exercise)}
          style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        >
          <View style={styles.rowMain}>
            <Text style={styles.name} numberOfLines={1}>
              {exercise.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[
                equipmentLabel(exercise.equipment),
                TRACKING_LABELS[exercise.trackingType] ?? exercise.trackingType.replace(/_/g, " "),
              ].join(" \u00B7 ")}
            </Text>
          </View>
          {exercise.rankingEligibility !== "unsupported" && exercise.rankingGroup ? (
            <View
              style={[
                styles.rankBadge,
                exercise.rankingEligibility === "provisional" ? styles.rankProvisional : null,
              ]}
            >
              <Text style={styles.rankText} numberOfLines={1}>
                {(exercise.rankingEligibility === "provisional" ? "rank~ " : "rank ") + exercise.rankingGroup}
              </Text>
            </View>
          ) : null}
        </Pressable>
      );
    },
    [add],
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
        autoFocus
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsRow}
      >
        <Chip
          label="All"
          selected={group === null && tracking === null && equipment === undefined}
          onPress={() => {
            setGroup(null);
            setTracking(null);
            setEquipment(undefined);
          }}
          hitSlop={CHIP_HIT_SLOP}
        />
        {(Object.keys(GROUP_LABELS) as MajorGroup[]).map((g) => (
          <Chip
            key={g}
            label={GROUP_LABELS[g]}
            selected={group === g}
            onPress={() => setGroup(group === g ? null : g)}
            hitSlop={CHIP_HIT_SLOP}
          />
        ))}
        {(Object.keys(TRACKING_LABELS) as TrackingType[]).map((t) => (
          <Chip
            key={t}
            label={TRACKING_LABELS[t] ?? t}
            selected={tracking === t}
            onPress={() => setTracking(tracking === t ? null : t)}
            hitSlop={CHIP_HIT_SLOP}
          />
        ))}
        {EQUIPMENT_FILTERS.map((option) => (
          <Chip
            key={option.value ?? "no-equipment"}
            label={option.label}
            selected={equipment === option.value}
            onPress={() => setEquipment(toggleEquipmentFilter(equipment, option.value))}
            hitSlop={CHIP_HIT_SLOP}
          />
        ))}
      </ScrollView>
      <FlatList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  search: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: 44,
    marginHorizontal: space[4],
    marginTop: space[3],
    marginBottom: space[1],
  },
  chipsScroll: { flexGrow: 0 },
  // Single unwrapped row: chips size to their label content with sensible
  // padding, the row scrolls horizontally, and edge padding keeps the first
  // and last chip fully readable at rest.
  chipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[1],
  },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space.xxl,
    gap: space.md,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space[2],
    paddingHorizontal: space[1],
  },
  sectionTitle: { ...type.label, color: colors.textMuted, letterSpacing: 1.2 },
  sectionCount: { ...type.caption, color: colors.textMuted, fontVariant: ["tabular-nums"] },
  empty: { ...type.caption, color: colors.textMuted, textAlign: "center", paddingVertical: space.lg },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  // Two-column row: left content flexes and truncates only when genuinely
  // required; the rank badge keeps an intrinsic width and stable right
  // alignment (it can never push the text into clipping).
  rowMain: { flex: 1 },
  name: { ...type.body, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 2, textTransform: "capitalize" },
  rankBadge: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSubtle,
    paddingHorizontal: space[2],
    paddingVertical: 3,
  },
  rankProvisional: { borderColor: colors.accent },
  rankText: { ...type.label, color: colors.accent },
});
