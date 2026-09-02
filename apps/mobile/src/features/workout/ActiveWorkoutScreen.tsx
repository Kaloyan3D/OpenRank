import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { TrackingType, WorkoutSetInput } from "@openrank/domain";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useUnits } from "../../ui/units";
import { usesWeightField } from "../../ui/tracking";
import { groupSupersets } from "../../ui/supersets";
import { RestTimerBar } from "../../ui/RestTimerBar";
import { colors, spacing } from "../../theme/tokens";
import { WorkoutHeader } from "./WorkoutHeader";
import { ExerciseCard } from "./ExerciseCard";

/**
 * Active workout screen (Phase 4 tasks F/L/K/AD; Phase 7.1 extraction spec
 * 28/29). Behavior-preserving decomposition: the route file renders this
 * component; canonical workout-exercise mutations (remove / reorder /
 * superset) now flow through WorkoutService - the UI never decides canonical
 * persistence policy.
 *
 * Every meaningful mutation persists immediately (autosave): set values
 * commit on field end-editing, completion flushes the pending buffer first,
 * notes commit on blur. Nothing waits for "Finish Workout".
 */
export function ActiveWorkoutScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();

  const profile = repos.profile.getDefault();
  const [, setNonce] = useState(0);
  const refresh = () => setNonce((n) => n + 1);

  // Canonical read (service -> repository -> SQLite) on every render. React
  // state below is transient input only - a reload reproduces everything.
  const session = profile ? services.workout.resumeActiveWorkout(profile.id) : null;
  const exerciseMeta = new Map<string, ExerciseMeta>();
  const previous = new Map<string, PreviousPerf>();
  if (session && profile) {
    for (const e of session.exercises) {
      const id = e.workoutExercise.exerciseId;
      exerciseMeta.set(id, repos.exercise.findById(id));
      previous.set(id, services.workout.getPreviousPerformance(profile.id, id, session.workout.id));
    }
  }

  // Pending (uncommitted) input buffers: flushed on completion, finish and
  // unmount so no acknowledged user action can be lost (task K).
  const pendingRef = useRef(new Map<string, WorkoutSetInput>());
  const flushAll = () => {
    for (const [setId, input] of pendingRef.current) {
      try {
        services.workout.updateSet(setId, input);
      } catch {
        /* workout gone (discarded elsewhere) - drop the buffer */
      }
    }
    pendingRef.current.clear();
  };
  useEffect(() => {
    return () => flushAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitSet = (setId: string, input: WorkoutSetInput) => {
    pendingRef.current.set(setId, { ...(pendingRef.current.get(setId) ?? {}), ...input });
    try {
      services.workout.updateSet(setId, input);
      pendingRef.current.delete(setId);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("set not found")) {
        pendingRef.current.delete(setId);
        return;
      }
      Alert.alert("Cannot save set", err instanceof Error ? err.message : String(err));
    }
  };

  const completeSet = (setId: string) => {
    // Flush the pending buffer FIRST, then complete: one atomic operation.
    const buffered = pendingRef.current.get(setId);
    if (buffered) {
      try {
        services.workout.updateSet(setId, buffered);
      } catch {
        /* set gone */
      }
      pendingRef.current.delete(setId);
    }
    try {
      services.workout.completeSet(setId);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("set not found")) {
        refresh();
        return;
      }
      Alert.alert("Cannot complete set", err instanceof Error ? err.message : String(err));
    }
    refresh();
  };

  if (!profile || !session) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No active workout.</Text>
      </View>
    );
  }

  const workout = session.workout;
  const rest = services.restTimer.getActive(profile.id);
  const blocks = groupSupersets(session.exercises);
  const incompleteCount = session.exercises.flatMap((e) => e.sets).filter((s) => s.completedAt == null).length;

  const addSet = (
    workoutExerciseId: string,
    trackingType: TrackingType,
    targets: { targetRepsMin: number | null; targetRepsMax: number | null; targetWeightKg: number | null } | null,
    lastSet: WorkoutSetLike,
  ) => {
    const input: WorkoutSetInput = { setType: lastSet?.setType ?? "normal" };
    if (usesWeightField(trackingType)) {
      input.weightKg = lastSet?.weightKg ?? targets?.targetWeightKg ?? null;
    }
    if (trackingType !== "duration" && trackingType !== "distance_duration") {
      input.reps = lastSet?.reps ?? targets?.targetRepsMin ?? null;
    }
    if (trackingType === "duration") {
      input.durationSeconds = lastSet?.durationSeconds ?? null;
    }
    if (trackingType === "distance_duration") {
      input.distanceMeters = lastSet?.distanceMeters ?? null;
      input.durationSeconds = lastSet?.durationSeconds ?? null;
    }
    services.workout.addSet(workoutExerciseId, input);
    refresh();
  };

  const finishWith = (policy: "remove" | "reject") => {
    flushAll();
    let summary: ReturnType<typeof services.workout.finishWorkout>;
    try {
      summary = services.workout.finishWorkout(workout.id, { incompleteSetPolicy: policy });
    } catch (err) {
      Alert.alert("Cannot finish", err instanceof Error ? err.message : String(err));
      return;
    }
    let derivedStatus: "done" | "deferred" = "deferred";
    try {
      const report = services.derived.processPending();
      derivedStatus = report.errors.length === 0 ? "done" : "deferred";
    } catch {
      derivedStatus = "deferred";
    }
    let streakStatus: "done" | "deferred" = "deferred";
    try {
      const streakReport = services.streak.processPending({
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      streakStatus = streakReport.errors.length === 0 ? "done" : "deferred";
    } catch {
      streakStatus = "deferred";
    }
    void services.notifications
      .reconcileNotifications(profile.id, {
        todayUtc: new Date().toISOString(),
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      })
      .catch(() => {});
    router.replace("/history/" + summary.workout.id + "?derived=" + derivedStatus + "&streak=" + streakStatus);
  };

  const finishWorkout = () => {
    if (incompleteCount > 0) {
      Alert.alert(
        "Finish workout?",
        String(incompleteCount) + " incomplete set row(s). Empty rows are never counted as done.",
        [
          { text: "Return to workout", style: "cancel" },
          { text: "Remove " + String(incompleteCount) + " & finish", onPress: () => finishWith("remove") },
        ],
      );
      return;
    }
    Alert.alert("Finish workout?", "This ends the workout and saves it to history.", [
      { text: "Cancel", style: "cancel" },
      { text: "Finish", onPress: () => finishWith("reject") },
    ]);
  };

  const discardWorkout = () => {
    Alert.alert("Discard workout?", "This will permanently delete this active workout and its logged sets.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          flushAll();
          try {
            services.workout.discardWorkout(workout.id);
            router.back();
          } catch (err) {
            Alert.alert("Cannot discard", err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <WorkoutHeader
          title={workout.title ?? "Workout"}
          startedAt={workout.startedAt}
          finishedAt={workout.finishedAt}
          notes={workout.notes}
          onNotes={(notes) => {
            services.workout.updateWorkoutNotes(workout.id, notes);
            refresh();
          }}
        />

        {blocks.map((block) => (
          <View
            key={block.items[0]!.workoutExercise.id}
            style={[styles.block, block.label ? styles.blockSuperset : null]}
          >
            {block.label ? <Text style={styles.supersetLabel}>Superset {block.label}</Text> : null}
            {block.items.map((e) => {
              const meta = exerciseMeta.get(e.workoutExercise.exerciseId) ?? null;
              return (
                <ExerciseCard
                  key={e.workoutExercise.id}
                  detail={e}
                  meta={meta}
                  previous={previous.get(e.workoutExercise.exerciseId) ?? null}
                  units={units}
                  onCommitSet={commitSet}
                  onComplete={completeSet}
                  onUncomplete={(setId) => {
                    services.workout.uncompleteSet(setId);
                    refresh();
                  }}
                  onDeleteSet={(setId) => {
                    services.workout.deleteSet(setId);
                    refresh();
                  }}
                  onAddSet={() =>
                    addSet(
                      e.workoutExercise.id,
                      meta?.trackingType ?? "weight_reps",
                      e.workoutExercise.targetSets && e.workoutExercise.targetSets.length > 0
                        ? e.workoutExercise.targetSets[0]!
                        : null,
                      e.sets.length > 0 ? e.sets[e.sets.length - 1]! : null,
                    )
                  }
                  onNotes={(notes) => {
                    services.workout.updateExerciseNotes(e.workoutExercise.id, notes);
                    refresh();
                  }}
                  onRemove={() =>
                    Alert.alert(
                      "Remove exercise?",
                      "Remove " + (meta?.name ?? "this exercise") + " and its sets from the workout?",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: () => {
                            // Canonical mutation through the service layer.
                            services.workout.removeExercise(e.workoutExercise.id);
                            refresh();
                          },
                        },
                      ],
                    )
                  }
                  onReorder={(dir) => {
                    const ids = session.exercises.map((x) => x.workoutExercise.id);
                    const i = ids.indexOf(e.workoutExercise.id);
                    const j = i + dir;
                    if (j < 0 || j >= ids.length) return;
                    const swapped = [...ids];
                    swapped[i] = swapped[j]!;
                    swapped[j] = ids[i]!;
                    // Canonical mutation through the service layer.
                    services.workout.reorderExercises(workout.id, swapped);
                    refresh();
                  }}
                  onSuperset={(g) => {
                    // Canonical mutation through the service layer.
                    services.workout.updateSuperset(e.workoutExercise.id, g);
                    refresh();
                  }}
                />
              );
            })}
          </View>
        ))}

        <Pressable
          style={[styles.button, styles.addExercise]}
          onPress={() => router.push("/exercise-picker?context=workout&id=" + workout.id)}
        >
          <Text style={styles.addExerciseText}>+ Add Exercise</Text>
        </Pressable>

        <View style={styles.finishRow}>
          <Pressable style={[styles.button, styles.finish]} onPress={finishWorkout}>
            <Text style={styles.finishText}>Finish Workout</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.discard]} onPress={discardWorkout}>
            <Text style={styles.discardText}>Discard</Text>
          </Pressable>
        </View>
      </ScrollView>

      {rest ? (
        <View style={styles.restDock}>
          <RestTimerBar
            rest={rest}
            onAdjust={(d) => {
              services.restTimer.addSeconds(profile.id, d);
              refresh();
            }}
            onSkip={() => {
              services.restTimer.skip(profile.id);
              refresh();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

type ExerciseMeta = ReturnType<ReturnType<typeof useRepos>["exercise"]["findById"]>;
type PreviousPerf = ReturnType<ReturnType<typeof useServices>["workout"]["getPreviousPerformance"]>;
type WorkoutSetLike =
  | {
      setType: WorkoutSetInput["setType"];
      weightKg: number | null;
      reps: number | null;
      durationSeconds: number | null;
      distanceMeters: number | null;
    }
  | null;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: 140 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  muted: { color: colors.textMuted },
  block: { gap: spacing.sm },
  blockSuperset: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing.sm },
  supersetLabel: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  addExercise: { borderWidth: 1, borderColor: "#2a3242", borderRadius: 12, paddingVertical: 14 },
  addExerciseText: { color: colors.accent, fontWeight: "700", textAlign: "center" },
  finishRow: { flexDirection: "row", gap: spacing.sm },
  finish: { backgroundColor: colors.accent, flex: 2, paddingVertical: 16 },
  finishText: { color: "#0b1220", fontWeight: "700", fontSize: 16, textAlign: "center" },
  discard: { borderWidth: 1, borderColor: "#a05a5a", flex: 1 },
  discardText: { color: "#e8a0a0", textAlign: "center", fontWeight: "600" },
  restDock: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.md },
});
