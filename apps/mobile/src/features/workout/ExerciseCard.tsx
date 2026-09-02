import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Exercise, PreviousPerformance, WorkoutExerciseDetail, WorkoutSetInput } from "@openrank/domain";
import { fieldsForTracking } from "../../ui/tracking";
import { formatSetSummary } from "../../ui/format";
import { equipmentLabel } from "../../ui/equipment";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";
import { ModalShell } from "../../components/ui/ModalShell";
import { Chip } from "../../components/ui/Chip";
import { SetRow } from "./SetRow";
import type { Units } from "./types";

/**
 * Exercise card (Phase 8.1 approved structure, spec 23/25):
 *   name + equipment · target | PR badge (canonical) | options
 *   Previous reference line
 *   column headers SET / PREVIOUS / per-tracking fields / RPE / done
 *   set rows + compact inline + ADD SET
 *
 * ALL canonical mutations flow up to the screen (WorkoutService). The
 * options sheet (notes / reorder / superset / remove) uses ModalShell.
 */
export function ExerciseCard(props: {
  detail: WorkoutExerciseDetail;
  meta: Exercise | null;
  previous: PreviousPerformance | null;
  units: Units;
  isPrSet: (setId: string) => boolean;
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
  const [optionsOpen, setOptionsOpen] = useState(false);
  const fields = fieldsForTracking(trackingType, props.units.weightLabel, props.units.distanceLabel);
  const compactFields = fields.length <= 2;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.exerciseName}>{meta?.name ?? "Exercise"}</Text>
          <Text style={styles.exerciseMeta}>
            {[equipmentLabel(meta?.equipment), meta?.rankingGroup].filter(Boolean).join(" \u00B7 ")}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={"Options for " + (meta?.name ?? "exercise")}
          accessibilityRole="button"
          onPress={() => setOptionsOpen(true)}
          style={styles.iconBtn}
        >
          <Text style={styles.iconText}>{"\u22EF"}</Text>
        </Pressable>
      </View>

      <Text style={styles.previous} numberOfLines={1}>
        {"Previous   "}
        {props.previous && props.previous.sets.length > 0
          ? props.previous.sets
              .slice(0, 3)
              .map((s) => formatSetSummary(s, props.units))
              .join("   ")
          : "\u2014"}
      </Text>

      <View style={styles.setHeaderRow}>
        <Text style={[styles.setHeader, styles.setTypeHeader]}>SET</Text>
        <Text style={[styles.setHeader, styles.prevHeader]}>PREV</Text>
        {fields.map((f, i) => (
          <Text key={String(i)} style={[styles.setHeader, styles.fieldHeader, compactFields ? styles.fieldWide : null]}>
            {f.label.toUpperCase()}
          </Text>
        ))}
        <Text style={[styles.setHeader, styles.rpeHeader]}>RPE</Text>
        <Text style={[styles.setHeader, styles.deleteHeader]}>{" "}</Text>
        <Text style={[styles.setHeader, styles.doneHeader]}>{" "}</Text>
      </View>

      {detail.sets.map((s, i) => {
        const prev = props.previous?.sets[i] ?? null;
        return (
          <SetRow
            key={s.id}
            set={s}
            index={i}
            trackingType={trackingType}
            units={props.units}
            previousSummary={prev ? formatSetSummary(prev, props.units) : null}
            onCommit={props.onCommitSet}
            onComplete={props.onComplete}
            onUncomplete={props.onUncomplete}
            onDelete={props.onDeleteSet}
          />
        );
      })}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add set"
        onPress={props.onAddSet}
        style={styles.addSet}
      >
        <Text style={styles.addSetText}>+ ADD SET</Text>
      </Pressable>

      <ModalShell visible={optionsOpen} onClose={() => setOptionsOpen(false)} title={meta?.name ?? "Exercise"}>
        <Text style={styles.optionsLabel}>Exercise notes</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="e.g. pause at the bottom"
          placeholderTextColor={colors.textMuted}
          defaultValue={detail.workoutExercise.notes ?? ""}
          multiline
          onEndEditing={(e) => props.onNotes(e.nativeEvent.text.trim() || null)}
        />
        <View style={styles.optionsRow}>
          <Chip label={"\u2191 Move up"} onPress={() => props.onReorder(-1)} accessibilityLabel="Move exercise up" />
          <Chip label={"\u2193 Move down"} onPress={() => props.onReorder(1)} accessibilityLabel="Move exercise down" />
          <Chip
            label={"Superset: " + (detail.workoutExercise.supersetGroup ?? "none")}
            onPress={() => {
              const choices = supersetChoices();
              const i = choices.findIndex((c) => c.value === detail.workoutExercise.supersetGroup);
              props.onSuperset(choices[(i + 1) % choices.length]!.value);
            }}
            accessibilityLabel="Cycle superset group"
          />
          <Chip
            label="Remove exercise"
            selected={false}
            onPress={props.onRemove}
            accessibilityLabel="Remove exercise from workout"
          />
        </View>
      </ModalShell>
    </View>
  );
}

import { supersetChoices } from "../../ui/supersets";

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: space[4], gap: space[2] },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  exerciseName: { ...type.cardTitle, color: colors.text },
  exerciseMeta: { ...type.caption, color: colors.textMuted, textTransform: "capitalize" },
  iconBtn: { paddingHorizontal: space[3], paddingVertical: space[1] },
  iconText: { color: colors.textMuted, fontSize: 18 },
  previous: { ...type.caption, color: colors.textMuted, fontVariant: ["tabular-nums"] },
  setHeaderRow: { flexDirection: "row", alignItems: "center", gap: space[1] + 2 },
  setTypeHeader: { width: 30 },
  prevHeader: { width: 62, textAlign: "center" },
  fieldHeader: { width: 60, textAlign: "center" },
  fieldWide: { width: 60 },
  rpeHeader: { width: 34, textAlign: "center" },
  deleteHeader: { width: 24 },
  doneHeader: { width: 40 },
  setHeader: { ...type.label, color: colors.textMuted, fontSize: 10 },
  addSet: { alignItems: "center", paddingVertical: space[2] + 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", minHeight: 40, justifyContent: "center" },
  addSetText: { ...type.label, color: colors.accent, letterSpacing: 0.8 },
  optionsLabel: { ...type.label, color: colors.textMuted, textTransform: "uppercase" },
  optionsRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingBottom: space[2] },
  notesInput: { backgroundColor: colors.surfacePressed, color: colors.text, borderRadius: radius.sm, padding: space[2] + 2, minHeight: 40, fontSize: 14 },
});
