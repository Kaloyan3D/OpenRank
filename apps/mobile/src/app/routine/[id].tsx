import { useCallback, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { RoutineDetail, SetType } from "@openrank/domain";
import { ActiveWorkoutConflictError } from "@openrank/database";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { supersetChoices } from "../../ui/supersets";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Routine builder (Phase 4, tasks R/S): rename, archive, delete, exercises
 * with rest/superset/targets, reorder, remove, add (picker). Targets are
 * guidance copied into workouts at start - editing targets here never
 * changes an already-started or finished workout.
 */

const SET_TYPES: SetType[] = ["normal", "warmup", "drop", "failure", "amrap"];

export default function RoutineBuilderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const routineId = typeof params.id === "string" ? params.id : "";
  const repos = useRepos();
  const services = useServices();
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  void nonce;

  const [renameOpen, setRenameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  let detail: RoutineDetail | null = null;
  try {
    detail = routineId ? services.routine.get(routineId) : null;
  } catch {
    detail = null;
  }

  if (!detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Routine not found.</Text>
      </View>
    );
  }

  const { routine, exercises } = detail;

  const startWorkout = () => {
    const profile = repos.profile.getDefault();
    if (!profile) return;
    try {
      const w = services.workout.startWorkoutFromRoutine(profile.id, routine.id, {
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      router.push("/workout/" + w.id);
    } catch (err) {
      if (err instanceof ActiveWorkoutConflictError) {
        const current = services.workout.resumeActiveWorkout(profile.id);
        Alert.alert("Workout already active", "Finish or discard the active workout first.", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Resume",
            onPress: () => {
              if (current) router.push("/workout/" + current.workout.id);
            },
          },
          {
            text: "Discard & start",
            style: "destructive",
            onPress: () => {
              if (current) services.workout.discardWorkout(current.workout.id);
              const w = services.workout.startWorkoutFromRoutine(profile.id, routine.id, {
                timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
              });
              router.push("/workout/" + w.id);
            },
          },
        ]);
        return;
      }
      Alert.alert("Cannot start workout", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable
        accessibilityLabel="Rename routine"
        onPress={() => {
          setNameDraft(routine.name);
          setRenameOpen(true);
        }}
        style={styles.titleRow}
      >
        <Text style={styles.title}>{routine.name}</Text>
        <Text style={styles.editHint}>rename</Text>
      </Pressable>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.button, styles.secondary]}
          onPress={() => {
            if (routine.archivedAt == null) services.routine.archive(routine.id);
            else services.routine.unarchive(routine.id);
            refresh();
          }}
        >
          <Text style={styles.secondaryText}>{routine.archivedAt == null ? "Archive" : "Unarchive"}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.danger]}
          onPress={() =>
            Alert.alert("Delete routine?", "Workouts started from it keep their history.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  services.routine.delete(routine.id);
                  router.back();
                },
              },
            ])
          }
        >
          <Text style={styles.dangerText}>Delete</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.primary]} onPress={startWorkout}>
          <Text style={styles.primaryText}>Start</Text>
        </Pressable>
      </View>

      {exercises.map((re, i) => (
        <View key={re.id} style={[styles.card, re.supersetGroup ? styles.cardSuperset : null]}>
          <View style={styles.cardHeader}>
            <Text style={styles.order}>{String(i + 1)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.exerciseName}>{repos.exercise.findById(re.exerciseId)?.name ?? "Exercise"}</Text>
              <Text style={styles.exerciseMeta}>
                rest {re.restSeconds == null ? "-" : String(re.restSeconds) + "s"}
                {re.supersetGroup ? " - superset " + re.supersetGroup : ""}
              </Text>
            </View>
            <Pressable accessibilityLabel="Remove exercise" onPress={() => { services.routine.removeExercise(re.id); refresh(); }} style={styles.iconBtn}>
              <Text style={styles.deleteText}>{"\u00D7"}</Text>
            </Pressable>
          </View>

          {/* Targets (task S): guidance rows; replaced transactionally. */}
          {re.targets.map((t, ti) => (
            <Text key={t.id} style={styles.targetLine}>
              {"Set " + String(ti + 1) + ": " + t.setType + (t.targetRepsMin != null ? " " + String(t.targetRepsMin) + (t.targetRepsMax != null && t.targetRepsMax !== t.targetRepsMin ? "-" + String(t.targetRepsMax) : "+") : "")}
            </Text>
          ))}

          <View style={styles.targetEditor}>
            <Text style={styles.editorLabel}>targets</Text>
            {re.targets.map((t) => (
              <View key={t.id} style={styles.targetRow}>
                <Text style={styles.targetType}>{t.setType}</Text>
                <Text style={styles.targetReps}>
                  {t.targetRepsMin == null ? "-" : String(t.targetRepsMin)}
                  {t.targetRepsMax != null ? "-" + String(t.targetRepsMax) : "+"} reps
                </Text>
                <Pressable
                  accessibilityLabel="Remove target set"
                  onPress={() => {
                    services.routine.setTargets(
                      re.id,
                      re.targets.filter((x) => x.id !== t.id).map((x) => ({
                        setType: x.setType,
                        targetRepsMin: x.targetRepsMin,
                        targetRepsMax: x.targetRepsMax,
                        targetWeightKg: x.targetWeightKg,
                        targetRpe: x.targetRpe,
                        targetRir: x.targetRir,
                      })),
                    );
                    refresh();
                  }}
                >
                  <Text style={styles.deleteText}>{"\u00D7"}</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.editorRow}>
              <Pressable
                accessibilityLabel="Add target set"
                style={[styles.optionBtn, styles.editorBtn]}
                onPress={() => {
                  services.routine.setTargets(re.id, [
                    ...re.targets.map((x) => ({
                      setType: x.setType,
                      targetRepsMin: x.targetRepsMin,
                      targetRepsMax: x.targetRepsMax,
                      targetWeightKg: x.targetWeightKg,
                      targetRpe: x.targetRpe,
                      targetRir: x.targetRir,
                    })),
                    { setType: "normal", targetRepsMin: 8, targetRepsMax: 10 },
                  ]);
                  refresh();
                }}
              >
                <Text style={styles.optionText}>+ target set</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Cycle target reps range"
                style={[styles.optionBtn, styles.editorBtn]}
                onPress={() => {
                  const ranges: [number | null, number | null][] = [
                    [8, 10], [6, 8], [5, 6], [10, 12], [12, 15], [3, 5], [null, null],
                  ];
                  const cur = re.targets[re.targets.length - 1];
                  const idx = ranges.findIndex(([lo, hi]) => lo === (cur?.targetRepsMin ?? null) && hi === (cur?.targetRepsMax ?? null));
                  const [lo, hi] = ranges[(idx + 1) % ranges.length]!;
                  services.routine.setTargets(re.id, re.targets.map((x, xi) => ({
                    setType: x.setType,
                    targetRepsMin: xi === re.targets.length - 1 ? lo : x.targetRepsMin,
                    targetRepsMax: xi === re.targets.length - 1 ? hi : x.targetRepsMax,
                    targetWeightKg: x.targetWeightKg,
                    targetRpe: x.targetRpe,
                    targetRir: x.targetRir,
                  })));
                  refresh();
                }}
              >
                <Text style={styles.optionText}>reps range</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.optionsRow}>
            <Pressable accessibilityLabel="Move up" onPress={() => reorder(services, exercises, routine.id, i, -1, refresh)} style={styles.optionBtn}>
              <Text style={styles.optionText}>{"\u2191"}</Text>
            </Pressable>
            <Pressable accessibilityLabel="Move down" onPress={() => reorder(services, exercises, routine.id, i, 1, refresh)} style={styles.optionBtn}>
              <Text style={styles.optionText}>{"\u2193"}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Cycle rest time"
              style={styles.optionBtn}
              onPress={() => {
                const presets = [null, 60, 90, 120, 180, 240];
                const idx = presets.indexOf(re.restSeconds);
                services.routine.setRestSeconds(re.id, presets[(idx + 1) % presets.length]!);
                refresh();
              }}
            >
              <Text style={styles.optionText}>rest {re.restSeconds ?? "-"}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Cycle superset group"
              style={styles.optionBtn}
              onPress={() => {
                const choices = supersetChoices();
                const idx = choices.findIndex((c) => c.value === re.supersetGroup);
                services.routine.setSupersetGroup(re.id, choices[(idx + 1) % choices.length]!.value);
                refresh();
              }}
            >
              <Text style={styles.optionText}>ss: {re.supersetGroup ?? "none"}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Cycle target set type"
              style={styles.optionBtn}
              onPress={() => {
                if (re.targets.length === 0) return;
                const last = re.targets[re.targets.length - 1]!;
                const t = SET_TYPES[(SET_TYPES.indexOf(last.setType) + 1) % SET_TYPES.length]!;
                services.routine.setTargets(re.id, re.targets.map((x, xi) => ({
                  setType: xi === re.targets.length - 1 ? t : x.setType,
                  targetRepsMin: x.targetRepsMin,
                  targetRepsMax: x.targetRepsMax,
                  targetWeightKg: x.targetWeightKg,
                  targetRpe: x.targetRpe,
                  targetRir: x.targetRir,
                })));
                refresh();
              }}
            >
              <Text style={styles.optionText}>type: {re.targets[re.targets.length - 1]?.setType ?? "-"}</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Pressable
        style={[styles.button, styles.addExercise]}
        onPress={() => router.push("/exercise-picker?context=routine&id=" + routine.id)}
      >
        <Text style={styles.addExerciseText}>+ Add Exercise</Text>
      </Pressable>

      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename routine</Text>
            <TextInput style={styles.input} value={nameDraft} onChangeText={setNameDraft} autoFocus onSubmitEditing={() => setRenameOpen(false)} />
            <View style={styles.actionRow}>
              <Pressable style={[styles.button, styles.secondary]} onPress={() => setRenameOpen(false)}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.primary]}
                onPress={() => {
                  try {
                    services.routine.rename(routine.id, nameDraft);
                  } catch (err) {
                    Alert.alert("Cannot rename", err instanceof Error ? err.message : String(err));
                  }
                  setRenameOpen(false);
                  refresh();
                }}
              >
                <Text style={styles.primaryText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function reorder(
  services: ReturnType<typeof useServices>,
  exercises: RoutineDetail["exercises"],
  routineId: string,
  i: number,
  dir: -1 | 1,
  refresh: () => void,
): void {
  const j = i + dir;
  if (j < 0 || j >= exercises.length) return;
  const ids = exercises.map((e) => e.id);
  const swapped = [...ids];
  swapped[i] = swapped[j]!;
  swapped[j] = ids[i]!;
  services.routine.reorderExercises(routineId, swapped);
  refresh();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  muted: { color: colors.textMuted },
  titleRow: { flexDirection: "row", alignItems: "center" },
  title: { ...typography.title, color: colors.text, flex: 1 },
  editHint: { color: colors.accent, fontSize: 12 },
  actionRow: { flexDirection: "row", gap: 8 },
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, alignItems: "center", minHeight: 44, justifyContent: "center", flex: 1 },
  primary: { backgroundColor: colors.accent },
  primaryText: { color: "#0b1220", fontWeight: "700" },
  secondary: { borderWidth: 1, borderColor: colors.textMuted },
  secondaryText: { color: colors.text },
  danger: { borderWidth: 1, borderColor: "#a05a5a" },
  dangerText: { color: "#e8a0a0" },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: 6 },
  cardSuperset: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  order: { color: colors.textMuted, fontWeight: "700", width: 20 },
  exerciseName: { ...typography.body, color: colors.text, fontWeight: "600" },
  exerciseMeta: { ...typography.caption, color: colors.textMuted },
  iconBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  deleteText: { color: "#e8a0a0", fontSize: 18 },
  targetLine: { ...typography.caption, color: colors.text, paddingLeft: 28 },
  targetEditor: { paddingLeft: 28, gap: 4 },
  editorLabel: { color: colors.textMuted, fontSize: 10, textTransform: "uppercase" },
  targetRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  targetType: { color: "#e0b45a", fontSize: 12, width: 64, textTransform: "capitalize" },
  targetReps: { color: colors.text, fontSize: 12, flex: 1 },
  editorRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  editorBtn: { paddingVertical: 6 },
  optionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  optionBtn: { borderWidth: 1, borderColor: "#2a3242", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  optionText: { color: colors.text, fontSize: 12 },
  addExercise: { borderWidth: 1, borderColor: "#2a3242", borderRadius: 12, paddingVertical: 14 },
  addExerciseText: { color: colors.accent, fontWeight: "700", textAlign: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.lg, width: "86%", gap: 12 },
  modalTitle: { ...typography.body, color: colors.text, fontWeight: "700" },
  input: { backgroundColor: "#1c2330", color: colors.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 },
});