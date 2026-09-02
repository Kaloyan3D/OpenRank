import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type {
  Exercise,
  PreviousPerformance,
  WorkoutExerciseDetail,
  SetType,
  TrackingType,
  WorkoutSet,
  WorkoutSetInput,
} from "@openrank/domain";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useUnits } from "../../ui/units";
import { fieldsForTracking, usesWeightField } from "../../ui/tracking";
import { groupSupersets, supersetChoices } from "../../ui/supersets";
import { RestTimerBar } from "../../ui/RestTimerBar";
import { formatDuration, formatSetSummary } from "../../ui/format";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Active workout screen (Phase 4, tasks F/L/K/AD).
 *
 * Every meaningful mutation goes through WorkoutService and persists
 * immediately (autosave): set values commit on field end-editing, completion
 * flushes the pending buffer first, notes commit on blur. Nothing waits for
 * "Finish Workout". Duration is derived from started_at on every tick
 * (task Z) - no incrementing counter is stored.
 */

const SET_TYPES: SetType[] = ["normal", "warmup", "drop", "failure", "amrap"];

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();

  const profile = repos.profile.getDefault();
  const [, setNonce] = useState(0);
  const refresh = () => setNonce((n) => n + 1);

  // Canonical read (service -> repository -> SQLite) on every render. React
  // state below is transient input only - a reload reproduces everything.
  const session = profile
    ? services.workout.resumeActiveWorkout(profile.id)
    : null;
  const exerciseMeta = new Map<string, Exercise | null>();
  const previous = new Map<string, PreviousPerformance | null>();
  if (session && profile) {
    for (const e of session.exercises) {
      const id = e.workoutExercise.exerciseId;
      exerciseMeta.set(id, repos.exercise.findById(id));
      previous.set(
        id,
        services.workout.getPreviousPerformance(profile.id, id, session.workout.id),
      );
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
    // Flush the pending buffer FIRST, then complete: one atomic operation
    // (validate -> persist -> completed_at -> dirty markers -> rest timer).
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
    lastSet: WorkoutSet | null,
  ) => {
    // Prefill from the last set, else from the routine target snapshot.
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
    // Workout completion is already durable here. Record/rank updates are a
    // derived layer on top: run them now (fast, local); if anything fails the
    // summary still shows and the app-start repair finishes the work later.
    let derivedStatus: "done" | "deferred" = "deferred";
    try {
      const report = services.derived.processPending();
      derivedStatus = report.errors.length === 0 ? "done" : "deferred";
    } catch {
      derivedStatus = "deferred";
    }
    // Scheduled-session matching + streak projection (Phase 6): independent
    // of ranking; failure never endangers the saved workout (spec R/AU).
    let streakStatus: "done" | "deferred" = "deferred";
    try {
      const streakReport = services.streak.processPending({
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      streakStatus = streakReport.errors.length === 0 ? "done" : "deferred";
    } catch {
      streakStatus = "deferred";
    }
    // Phase 7 (spec K/P): the obligation resolved - remaining future
    // reminders for it must go. Fire-and-forget; the workout is already safe.
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
    Alert.alert(
      "Discard workout?",
      "This will permanently delete this active workout and its logged sets.",
      [
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
      ],
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{workout.title ?? "Workout"}</Text>
          <WorkoutTimer startedAt={workout.startedAt} finishedAt={workout.finishedAt} />
        </View>

        <TextInput
          style={styles.workoutNotes}
          placeholder="Workout notes..."
          placeholderTextColor={colors.textMuted}
          defaultValue={workout.notes ?? ""}
          multiline
          onEndEditing={(e) => services.workout.updateWorkoutNotes(workout.id, e.nativeEvent.text.trim() || null)}
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
                            repos.workout.removeExercise(e.workoutExercise.id);
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
                    repos.workout.reorderExercises(workout.id, swapped);
                    refresh();
                  }}
                  onSuperset={(g) => {
                    repos.workout.updateWorkoutExercise(e.workoutExercise.id, { supersetGroup: g });
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

/** Duration derived from timestamps on a 1 s tick (never stored). */
function WorkoutTimer(props: { startedAt: string; finishedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (props.finishedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [props.finishedAt]);
  const end = props.finishedAt ? Date.parse(props.finishedAt) : now;
  return (
    <Text style={styles.timer} accessibilityLabel="Workout duration">
      {formatDuration(Math.max(0, Math.round((end - Date.parse(props.startedAt)) / 1000)))}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Exercise card
// ---------------------------------------------------------------------------

function ExerciseCard(props: {
  detail: WorkoutExerciseDetail;
  meta: Exercise | null;
  previous: PreviousPerformance | null;
  units: ReturnType<typeof useUnits>;
  onCommitSet: (setId: string, input: WorkoutSetInput) => void;
  onComplete: (setId: string) => void;
  onUncomplete: (setId: string) => void;
  onDeleteSet: (setId: string) => void;
  onAddSet: () => void;
  onNotes: (notes: string | null) => void;
  onRemove: () => void;
  onReorder: (dir: -1 | 1) => void;
  onSuperset: (group: string | null) => void;
}) {
  const { detail, meta } = props;
  const trackingType = meta?.trackingType ?? "weight_reps";
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.exerciseName}>{meta?.name ?? "Exercise"}</Text>
          <Text style={styles.exerciseMeta}>
            {[meta?.equipment ?? "bodyweight", meta?.category].filter(Boolean).join(" - ")}
          </Text>
        </View>
        <Pressable accessibilityLabel="Exercise options" onPress={() => setExpanded((v) => !v)} style={styles.iconBtn}>
          <Text style={styles.iconText}>{"\u22EF"}</Text>
        </Pressable>
      </View>

      {/* Previous performance reference (task J) - never canonical state. */}
      <Text style={styles.previous} numberOfLines={1}>
        Previous{"  "}
        {props.previous && props.previous.sets.length > 0
          ? props.previous.sets
              .slice(0, 3)
              .map((s) => formatSetSummary(s, props.units))
              .join("   ")
          : "\u2014"}
      </Text>

      {/* Column headers for this exercise's tracking type (task G). */}
      <View style={styles.setHeaderRow}>
        <Text style={[styles.setHeader, styles.setTypeHeader]}>{"  "}SET</Text>
        {fieldsForTracking(trackingType).map((f, i) => (
          <Text key={String(i)} style={[styles.setHeader, styles.fieldHeader]}>
            {f.kind === "weight" ? props.units.weightLabel : f.label}
          </Text>
        ))}
        <Text style={[styles.setHeader, styles.doneHeader]}>done</Text>
        <Text style={[styles.setHeader, styles.doneHeader]}>{" "}</Text>
      </View>

      {detail.sets.map((s, i) => (
        <SetRow
          key={s.id}
          set={s}
          index={i}
          trackingType={trackingType}
          units={props.units}
          onCommit={props.onCommitSet}
          onComplete={props.onComplete}
          onUncomplete={props.onUncomplete}
          onDelete={props.onDeleteSet}
        />
      ))}

      <Pressable style={styles.addSet} accessibilityLabel="Add set" onPress={props.onAddSet}>
        <Text style={styles.addSetText}>+ Add Set</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.optionsPanel}>
          <Text style={styles.optionsTitle}>Exercise notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="e.g. pause at the bottom"
            placeholderTextColor={colors.textMuted}
            defaultValue={detail.workoutExercise.notes ?? ""}
            multiline
            onEndEditing={(e2) => props.onNotes(e2.nativeEvent.text.trim() || null)}
          />
          <View style={styles.optionsRow}>
            <Pressable accessibilityLabel="Move exercise up" onPress={() => props.onReorder(-1)} style={styles.optionBtn}>
              <Text style={styles.optionText}>{"\u2191 up"}</Text>
            </Pressable>
            <Pressable accessibilityLabel="Move exercise down" onPress={() => props.onReorder(1)} style={styles.optionBtn}>
              <Text style={styles.optionText}>{"\u2193 down"}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Cycle superset group"
              onPress={() => {
                const choices = supersetChoices();
                const i = choices.findIndex((c) => c.value === detail.workoutExercise.supersetGroup);
                props.onSuperset(choices[(i + 1) % choices.length]!.value);
              }}
              style={styles.optionBtn}
            >
              <Text style={styles.optionText}>superset: {detail.workoutExercise.supersetGroup ?? "none"}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Remove exercise from workout"
              onPress={props.onRemove}
              style={[styles.optionBtn, styles.optionDanger]}
            >
              <Text style={[styles.optionText, styles.optionDangerText]}>remove</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Set row: tracking-type aware fields, autosave on commit, big done control
// ---------------------------------------------------------------------------

function SetRow(props: {
  set: WorkoutSet;
  index: number;
  trackingType: TrackingType;
  units: ReturnType<typeof useUnits>;
  onCommit: (setId: string, input: WorkoutSetInput) => void;
  onComplete: (setId: string) => void;
  onUncomplete: (setId: string) => void;
  onDelete: (setId: string) => void;
}) {
  const { set, units } = props;
  const [typeModal, setTypeModal] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  // Local buffers = transient input state (allowed by task AC); committed on
  // end-editing and flushed before completion by the screen.
  const [weight, setWeight] = useState(units.toDisplay(set.weightKg));
  const [reps, setReps] = useState(set.reps == null ? "" : String(set.reps));
  const [durMin, setDurMin] = useState(set.durationSeconds == null ? "" : String(Math.floor(set.durationSeconds / 60)));
  const [durSec, setDurSec] = useState(set.durationSeconds == null ? "" : String(Math.round(set.durationSeconds % 60)));
  const [dist, setDist] = useState(units.distanceToDisplay(set.distanceMeters));
  const [rpe, setRpe] = useState(set.rpe == null ? "" : String(set.rpe));
  const [rir, setRir] = useState(set.rir == null ? "" : String(set.rir));

  const done = set.completedAt != null;

  const commitFull = () => {
    const input: WorkoutSetInput = {};
    for (const f of fieldsForTracking(props.trackingType)) {
      if (f.kind === "weight") input.weightKg = units.fromDisplay(weight);
      if (f.kind === "reps") {
        const r = parseInt(reps, 10);
        input.reps = Number.isFinite(r) && r >= 0 ? r : null;
      }
      if (f.kind === "duration" && f.label === "min") {
        const m = parseInt(durMin, 10);
        const s = parseInt(durSec, 10);
        input.durationSeconds =
          Number.isFinite(m) || Number.isFinite(s)
            ? (Number.isFinite(m) ? m * 60 : 0) + (Number.isFinite(s) ? s : 0)
            : null;
      }
      if (f.kind === "distance") input.distanceMeters = units.distanceFromDisplay(dist);
    }
    const rpeN = parseFloat(rpe);
    const rirN = parseInt(rir, 10);
    input.rpe = Number.isFinite(rpeN) ? rpeN : null;
    input.rir = Number.isFinite(rirN) ? rirN : null;
    props.onCommit(set.id, input);
  };

  return (
    <View style={[styles.row, done ? styles.rowDone : null]}>
      {/* Set number / type marker (press to change type, task H). */}
      <Pressable
        accessibilityLabel={"Set " + String(props.index + 1) + ", type " + set.setType + ". Press to change type."}
        onPress={() => setTypeModal(true)}
        style={styles.setTypeCell}
      >
        <Text style={[styles.setTypeText, set.setType !== "normal" ? styles.setTypeTextAlt : null]}>
          {set.setType === "normal" ? String(props.index + 1) : set.setType.slice(0, 1).toUpperCase()}
        </Text>
      </Pressable>

      {fieldsForTracking(props.trackingType).map((f) => {
        if (f.kind === "weight") {
          return (
            <TextInput
              key="w"
              style={[styles.cellInput, styles.weightCell, done ? styles.cellDone : null]}
              keyboardType="decimal-pad"
              value={weight}
              onChangeText={setWeight}
              onEndEditing={() => props.onCommit(set.id, { weightKg: units.fromDisplay(weight) })}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={"Set " + String(props.index + 1) + " weight in " + units.weightLabel}
            />
          );
        }
        if (f.kind === "reps") {
          return (
            <TextInput
              key="r"
              style={[styles.cellInput, styles.repsCell, done ? styles.cellDone : null]}
              keyboardType="number-pad"
              value={reps}
              onChangeText={setReps}
              onEndEditing={() => {
                const r = parseInt(reps, 10);
                props.onCommit(set.id, { reps: Number.isFinite(r) && r >= 0 ? r : null });
              }}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={"Set " + String(props.index + 1) + " reps"}
            />
          );
        }
        if (f.kind === "distance") {
          return (
            <TextInput
              key="d"
              style={[styles.cellInput, styles.weightCell, done ? styles.cellDone : null]}
              keyboardType="decimal-pad"
              value={dist}
              onChangeText={setDist}
              onEndEditing={() => props.onCommit(set.id, { distanceMeters: units.distanceFromDisplay(dist) })}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={"Set " + String(props.index + 1) + " distance in " + units.distanceLabel}
            />
          );
        }
        if (f.label === "min") {
          return (
            <TextInput
              key="dm"
              style={[styles.cellInput, styles.repsCell, done ? styles.cellDone : null]}
              keyboardType="number-pad"
              value={durMin}
              onChangeText={setDurMin}
              onEndEditing={commitFull}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={"Set " + String(props.index + 1) + " minutes"}
            />
          );
        }
        return (
          <TextInput
            key="ds"
            style={[styles.cellInput, styles.repsCell, done ? styles.cellDone : null]}
            keyboardType="number-pad"
            value={durSec}
            onChangeText={setDurSec}
            onEndEditing={commitFull}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={"Set " + String(props.index + 1) + " seconds"}
          />
        );
      })}

      {/* Large completion control (tasks AD/AF): text + color, never color-only. */}
      <Pressable
        accessibilityLabel={
          done
            ? "Set " + String(props.index + 1) + " done. Press to undo."
            : "Mark set " + String(props.index + 1) + " as done"
        }
        onPress={() => (done ? props.onUncomplete(set.id) : props.onComplete(set.id))}
        style={[styles.doneBtn, done ? styles.doneBtnOn : null]}
      >
        <Text style={[styles.doneText, done ? styles.doneTextOn : null]}>{done ? "done" : "log"}</Text>
      </Pressable>

      <Pressable
        accessibilityLabel={"Delete set " + String(props.index + 1)}
        onPress={() => props.onDelete(set.id)}
        style={styles.rowDelete}
      >
        <Text style={styles.deleteText}>{"\u00D7"}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Set details: RPE and RIR"
        onPress={() => setDetailOpen((v) => !v)}
        style={styles.rowDetail}
      >
        <Text style={[styles.detailText, set.rpe != null || set.rir != null ? styles.detailTextSet : null]}>
          {set.rpe != null ? "RPE " + String(set.rpe) : set.rir != null ? "RIR " + String(set.rir) : "rpe"}
        </Text>
      </Pressable>

      {detailOpen ? (
        <View style={styles.detailRow}>
          <TextInput
            style={styles.detailInput}
            keyboardType="decimal-pad"
            value={rpe}
            onChangeText={setRpe}
            onEndEditing={commitFull}
            placeholder="RPE 1-10"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Rate of perceived exertion, 1 to 10"
          />
          <TextInput
            style={styles.detailInput}
            keyboardType="number-pad"
            value={rir}
            onChangeText={setRir}
            onEndEditing={commitFull}
            placeholder="RIR 0-10"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Reps in reserve, 0 to 10"
          />
        </View>
      ) : null}

      {typeModal
        ? SetTypeModal({
            current: set.setType,
            onPick: (t) => {
              setTypeModal(false);
              props.onCommit(set.id, { setType: t });
            },
            onClose: () => setTypeModal(false),
          })
        : null}
    </View>
  );
}

function SetTypeModal(props: { current: SetType; onPick: (t: SetType) => void; onClose: () => void }) {
  return (
    <View style={styles.modalBackdrop}>
      <Pressable style={styles.modalFill} onPress={props.onClose} accessibilityLabel="Close set type picker" />
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>Set type</Text>
        <View style={styles.typeRow}>
          {SET_TYPES.map((t) => (
            <Pressable
              key={t}
              style={[styles.typeChip, props.current === t ? styles.typeChipActive : null]}
              onPress={() => props.onPick(t)}
            >
              <Text style={styles.typeChipText}>{t}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: 140 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  muted: { color: colors.textMuted },
  header: { flexDirection: "row", alignItems: "center" },
  title: { ...typography.title, color: colors.text, flex: 1 },
  timer: { color: colors.accent, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  workoutNotes: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    padding: spacing.sm,
    minHeight: 40,
    fontSize: 13,
  },
  block: { gap: spacing.sm },
  blockSuperset: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing.sm },
  supersetLabel: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.md, gap: 6 },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  exerciseName: { ...typography.body, color: colors.text, fontWeight: "700", textTransform: "uppercase" },
  exerciseMeta: { ...typography.caption, color: colors.textMuted, textTransform: "capitalize" },
  iconBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  iconText: { color: colors.textMuted, fontSize: 18 },
  previous: { color: colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  setHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  setTypeHeader: { width: 44 },
  fieldHeader: { width: 72, textAlign: "center" },
  doneHeader: { width: 56, textAlign: "center" },
  setHeader: { color: colors.textMuted, fontSize: 11, textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowDone: { opacity: 0.75 },
  setTypeCell: {
    width: 44,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#1c2330",
    alignItems: "center",
    justifyContent: "center",
  },
  setTypeText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  setTypeTextAlt: { color: "#e0b45a", fontSize: 12, textTransform: "uppercase" },
  cellInput: {
    backgroundColor: "#1c2330",
    color: colors.text,
    borderRadius: 8,
    height: 40,
    textAlign: "center",
    fontSize: 15,
    paddingVertical: 0,
  },
  weightCell: { width: 72 },
  repsCell: { width: 72 },
  cellDone: { color: colors.textMuted },
  doneBtn: {
    width: 56,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnOn: { backgroundColor: colors.accent },
  doneText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  doneTextOn: { color: "#0b1220" },
  rowDelete: { width: 26, height: 40, alignItems: "center", justifyContent: "center" },
  deleteText: { color: "#e8a0a0", fontSize: 20 },
  rowDetail: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  detailText: { color: colors.textMuted, fontSize: 11 },
  detailTextSet: { color: "#e0b45a" },
  detailRow: { flexDirection: "row", gap: 8, paddingLeft: 50 },
  detailInput: {
    backgroundColor: "#1c2330",
    color: colors.text,
    borderRadius: 8,
    height: 36,
    width: 100,
    textAlign: "center",
    fontSize: 13,
    paddingVertical: 0,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  addSet: { alignItems: "center", paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "#2a3242" },
  addSetText: { color: colors.accent, fontWeight: "600" },
  optionsPanel: { gap: 6, borderTopWidth: 1, borderTopColor: "#2a3242", paddingTop: 8 },
  optionsTitle: { color: colors.textMuted, fontSize: 11, textTransform: "uppercase" },
  optionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionBtn: { borderWidth: 1, borderColor: "#2a3242", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  optionDanger: { borderColor: "#5a2a2a" },
  optionDangerText: { color: "#e8a0a0" },
  optionText: { color: colors.text, fontSize: 12 },
  notesInput: {
    backgroundColor: "#1c2330",
    color: colors.text,
    borderRadius: 8,
    padding: 8,
    minHeight: 36,
    fontSize: 13,
  },
  addExercise: { borderWidth: 1, borderColor: "#2a3242", borderRadius: 12, paddingVertical: 14 },
  addExerciseText: { color: colors.accent, fontWeight: "700", textAlign: "center" },
  finishRow: { flexDirection: "row", gap: spacing.sm },
  finish: { backgroundColor: colors.accent, flex: 2, paddingVertical: 16 },
  finishText: { color: "#0b1220", fontWeight: "700", fontSize: 16, textAlign: "center" },
  discard: { borderWidth: 1, borderColor: "#a05a5a", flex: 1 },
  discardText: { color: "#e8a0a0", textAlign: "center", fontWeight: "600" },
  restDock: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.md },
  modalBackdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  modalFill: { position: "absolute", inset: 0 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.lg, width: "86%", gap: 10 },
  modalTitle: { ...typography.body, color: colors.text, fontWeight: "700" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  typeChip: { borderWidth: 1, borderColor: colors.textMuted, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  typeChipActive: { borderColor: colors.accent },
  typeChipText: { color: colors.text, fontSize: 12, textTransform: "capitalize" },
});