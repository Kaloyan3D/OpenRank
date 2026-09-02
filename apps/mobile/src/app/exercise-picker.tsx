import { useCallback, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Exercise, MajorGroup, TrackingType } from "@openrank/domain";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { useCanonicalRevision } from "../local-data/useCanonicalRevision";
import { colors } from "../design/colors";
import { spacing, typography } from "../theme/tokens";
import {
  EQUIPMENT_FILTERS,
  equipmentLabel,
  exercisePickerSearchOptions,
  toggleEquipmentFilter,
  type EquipmentFilterState,
} from "../ui/equipment";

/**
 * Exercise picker (Phase 4, task E; Phase 8.2 P0.1 filter correctness):
 * offline search + filters over the SQLite repository. Ranking support is an
 * indicator only - unsupported and provisional exercises remain fully
 * loggable (ranking != availability). Adding an exercise that is already
 * present asks for confirmation instead of silently creating a duplicate
 * block.
 *
 * Equipment filter semantics (see ui/equipment.ts): the default state is
 * undefined = no equipment filter, so the whole catalog is browsable. null
 * is only ever used as an explicit "No equipment" filter and is never the
 * default. Search runs without a row cap so "All" really means all.
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

  const renderItem = useCallback(
    ({ item }: { item: Exercise }) => (
      <Pressable style={styles.row} accessibilityLabel={"Add " + item.name} onPress={() => add(item)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.meta}>
            {[equipmentLabel(item.equipment), item.trackingType.replace(/_/g, " ")].join(" - ")}
          </Text>
        </View>
        {item.rankingEligibility !== "unsupported" && item.rankingGroup ? (
          <View style={[styles.rankBadge, item.rankingEligibility === "provisional" ? styles.rankProvisional : null]}>
            <Text style={styles.rankText}>
              {item.rankingEligibility === "provisional" ? "rank~ " : "rank "}
              {item.rankingGroup}
            </Text>
          </View>
        ) : null}
      </Pressable>
    ),
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsRow}>
        <Chip label="All" active={group === null && tracking === null && equipment === undefined} onPress={() => { setGroup(null); setTracking(null); setEquipment(undefined); }} />
        {(Object.keys(GROUP_LABELS) as MajorGroup[]).map((g) => (
          <Chip key={g} label={GROUP_LABELS[g]} active={group === g} onPress={() => setGroup(group === g ? null : g)} />
        ))}
        {(Object.keys(TRACKING_LABELS) as TrackingType[]).map((t) => (
          <Chip key={t} label={TRACKING_LABELS[t] ?? t} active={tracking === t} onPress={() => setTracking(tracking === t ? null : t)} />
        ))}
        {EQUIPMENT_FILTERS.map((option) => (
          <Chip
            key={option.value ?? "no-equipment"}
            label={option.label}
            active={equipment === option.value}
            onPress={() => setEquipment(toggleEquipmentFilter(equipment, option.value))}
          />
        ))}
      </ScrollView>

      {recent.length > 0 && query.trim() === "" ? (
        <>
          <Text style={styles.section}>Recent</Text>
          <FlatList
            data={recent}
            keyExtractor={(item) => "recent-" + item.id}
            renderItem={renderItem}
            style={styles.recentList}
          />
        </>
      ) : null}

      <Text style={styles.count}>{String(results.length)} exercises</Text>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

function Chip(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={[styles.chip, props.active ? styles.chipActive : null]}>
      <Text style={[styles.chipText, props.active ? styles.chipTextActive : null]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  search: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipsScroll: { flexGrow: 0, marginBottom: spacing.xs },
  chipsRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", paddingBottom: 4 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.textMuted, paddingHorizontal: 10, paddingVertical: 5 },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextActive: { color: colors.accent },
  section: { ...typography.caption, color: colors.accent, fontWeight: "700", marginTop: spacing.xs },
  recentList: { maxHeight: 260 },
  count: { ...typography.caption, color: colors.textMuted, marginVertical: 4 },
  listContent: { paddingBottom: 40, gap: 6 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
  },
  name: { ...typography.body, color: colors.text },
  meta: { ...typography.caption, color: colors.textMuted, marginTop: 2, textTransform: "capitalize" },
  rankBadge: { borderRadius: 999, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 8, paddingVertical: 3 },
  rankProvisional: { borderColor: colors.accent },
  rankText: { color: colors.accent, fontSize: 11 },
});