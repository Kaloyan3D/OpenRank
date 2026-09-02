import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Exercise, PreviousPerformance, WorkoutExerciseDetail, WorkoutSetInput } from "@openrank/domain";
import { fieldsForTracking } from "../../ui/tracking";
import { formatSetSummary } from "../../ui/format";
import { supersetChoices } from "../../ui/supersets";
import { colors, spacing, typography } from "../../theme/tokens";
import { SetRow } from "./SetRow";
import type { Units } from "./types";

/**
 * Exercise card (Phase 7.1 extraction, behavior-preserving): header with the
 * options panel (notes / reorder / superset / remove), previous-performance
 * reference line, per-tracking-type column headers and the set rows. ALL
 * canonical mutations flow up to the screen, which routes them through
 * WorkoutService.
 */
export function ExerciseCard(props: {
  detail: WorkoutExerciseDetail;
  meta: Exercise | null;
  previous: PreviousPerformance | null;
  units: Units;
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

      {/* Previous performance reference - never canonical state. */}
      <Text style={styles.previous} numberOfLines={1}>
        Previous{"  "}
        {props.previous && props.previous.sets.length > 0
          ? props.previous.sets
              .slice(0, 3)
              .map((s) => formatSetSummary(s, props.units))
              .join("   ")
          : "\u2014"}
      </Text>

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

const styles = StyleSheet.create({
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
  addSet: { alignItems: "center", paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "#2a3242" },
  addSetText: { color: colors.accent, fontWeight: "600" },
  optionsPanel: { gap: 6, borderTopWidth: 1, borderTopColor: "#2a3242", paddingTop: 8 },
  optionsTitle: { color: colors.textMuted, fontSize: 11, textTransform: "uppercase" },
  optionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionBtn: { borderWidth: 1, borderColor: "#2a3242", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  optionDanger: { borderColor: "#5a2a2a" },
  optionDangerText: { color: "#e8a0a0" },
  optionText: { color: colors.text, fontSize: 12 },
  notesInput: { backgroundColor: "#1c2330", color: colors.text, borderRadius: 8, padding: 8, minHeight: 36, fontSize: 13 },
});
