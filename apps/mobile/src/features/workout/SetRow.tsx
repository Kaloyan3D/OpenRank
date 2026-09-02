import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { WorkoutSet, WorkoutSetInput } from "@openrank/domain";
import { fieldsForTracking } from "../../ui/tracking";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";
import { SetTypeModal } from "./SetTypePicker";
import type { Units } from "./types";

/**
 * Set row (Phase 8.1 approved layout, spec 24/25):
 *   SET | PREVIOUS | <tracking fields> | RPE | (x) | done-check
 *
 * - Completed = success check; incomplete = neutral circle (never a fully
 *   bright green row).
 * - PREVIOUS shows the prior performance of this set position (canonical
 *   previous-performance read) - reference only, never editable state.
 * - RPE is optional (detail disclosure); tracking fields adapt honestly to
 *   the exercise's tracking mode (weight_reps / bodyweight_weighted /
 *   bodyweight_assisted / bodyweight_reps / reps_only / duration /
 *   distance_duration).
 * - Local buffers are transient input; commits go through onCommit (which
 *   routes to WorkoutService).
 */
export function SetRow(props: {
  set: WorkoutSet;
  index: number;
  trackingType: string;
  units: Units;
  previousSummary: string | null;
  onCommit: (setId: string, input: WorkoutSetInput) => void;
  onComplete: (setId: string) => void;
  onUncomplete: (setId: string) => void;
  onDelete: (setId: string) => void;
}) {
  const { set, units } = props;
  const [typeModal, setTypeModal] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const [weight, setWeight] = useState(units.toDisplay(set.weightKg));
  const [reps, setReps] = useState(set.reps == null ? "" : String(set.reps));
  const [durMin, setDurMin] = useState(set.durationSeconds == null ? "" : String(Math.floor(set.durationSeconds / 60)));
  const [durSec, setDurSec] = useState(set.durationSeconds == null ? "" : String(Math.round(set.durationSeconds % 60)));
  const [dist, setDist] = useState(units.distanceToDisplay(set.distanceMeters));
  const [rpe, setRpe] = useState(set.rpe == null ? "" : String(set.rpe));

  const done = set.completedAt != null;

  const commitFull = () => {
    const input: WorkoutSetInput = {};
    for (const f of fieldsForTracking(props.trackingType as never)) {
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
    input.rpe = Number.isFinite(rpeN) ? rpeN : null;
    props.onCommit(set.id, input);
  };

  return (
    <View style={[styles.row, done ? styles.rowDone : null]}>
      <Pressable
        accessibilityLabel={"Set " + String(props.index + 1) + ", type " + set.setType + ". Press to change type."}
        onPress={() => setTypeModal(true)}
        style={styles.setTypeCell}
      >
        <Text style={[styles.setTypeText, set.setType !== "normal" ? styles.setTypeTextAlt : null]}>
          {set.setType === "normal" ? String(props.index + 1) : set.setType.slice(0, 1).toUpperCase()}
        </Text>
      </Pressable>

      <Text style={styles.previousCell} numberOfLines={1}>
        {props.previousSummary ?? "\u2014"}
      </Text>

      {fieldsForTracking(props.trackingType as never, units.weightLabel, units.distanceLabel).map((f) => {
        if (f.kind === "weight") {
          return (
            <TextInput
              key="w"
              style={[styles.cellInput, done ? styles.cellDone : null]}
              keyboardType="decimal-pad"
              value={weight}
              onChangeText={setWeight}
              onEndEditing={() => props.onCommit(set.id, { weightKg: units.fromDisplay(weight) })}
              placeholder="0"
              placeholderTextColor={colors.textDisabled}
              accessibilityLabel={"Set " + String(props.index + 1) + " weight in " + units.weightLabel}
            />
          );
        }
        if (f.kind === "reps") {
          return (
            <TextInput
              key="r"
              style={[styles.cellInput, done ? styles.cellDone : null]}
              keyboardType="number-pad"
              value={reps}
              onChangeText={setReps}
              onEndEditing={() => {
                const r = parseInt(reps, 10);
                props.onCommit(set.id, { reps: Number.isFinite(r) && r >= 0 ? r : null });
              }}
              placeholder="0"
              placeholderTextColor={colors.textDisabled}
              accessibilityLabel={"Set " + String(props.index + 1) + " reps"}
            />
          );
        }
        if (f.kind === "distance") {
          return (
            <TextInput
              key="d"
              style={[styles.cellInput, done ? styles.cellDone : null]}
              keyboardType="decimal-pad"
              value={dist}
              onChangeText={setDist}
              onEndEditing={() => props.onCommit(set.id, { distanceMeters: units.distanceFromDisplay(dist) })}
              placeholder="0"
              placeholderTextColor={colors.textDisabled}
              accessibilityLabel={"Set " + String(props.index + 1) + " distance in " + units.distanceLabel}
            />
          );
        }
        if (f.label === "min") {
          return (
            <TextInput
              key="dm"
              style={[styles.cellInput, done ? styles.cellDone : null]}
              keyboardType="number-pad"
              value={durMin}
              onChangeText={setDurMin}
              onEndEditing={commitFull}
              placeholder="0"
              placeholderTextColor={colors.textDisabled}
              accessibilityLabel={"Set " + String(props.index + 1) + " minutes"}
            />
          );
        }
        return (
          <TextInput
            key="ds"
            style={[styles.cellInput, done ? styles.cellDone : null]}
            keyboardType="number-pad"
            value={durSec}
            onChangeText={setDurSec}
            onEndEditing={commitFull}
            placeholder="0"
            placeholderTextColor={colors.textDisabled}
            accessibilityLabel={"Set " + String(props.index + 1) + " seconds"}
          />
        );
      })}

      <Pressable
        accessible
        accessibilityLabel={
          set.rpe != null
            ? "Set " + String(props.index + 1) + " RPE " + String(set.rpe) + ". Press to edit."
            : "Set " + String(props.index + 1) + " RPE. Press to add."
        }
        onPress={() => setDetailOpen((v) => !v)}
        style={styles.rpeCell}
      >
        <Text style={[styles.rpeText, set.rpe != null ? styles.rpeTextSet : null]}>
          {set.rpe != null ? String(set.rpe) : "rpe"}
        </Text>
      </Pressable>

      <Pressable
        accessibilityLabel={"Delete set " + String(props.index + 1)}
        accessibilityRole="button"
        onPress={() => props.onDelete(set.id)}
        style={styles.deleteCell}
      >
        <Text style={styles.deleteText}>{"\u00D7"}</Text>
      </Pressable>

      <Pressable
        accessibilityLabel={
          done
            ? "Set " + String(props.index + 1) + " done. Press to undo."
            : "Mark set " + String(props.index + 1) + " as done"
        }
        accessibilityRole="button"
        accessibilityState={{ selected: done }}
        onPress={() => (done ? props.onUncomplete(set.id) : props.onComplete(set.id))}
        style={[styles.doneBtn, done ? styles.doneBtnOn : null]}
      >
        <Text style={[styles.doneGlyph, done ? styles.doneGlyphOn : null]}>
          {done ? "\u2713" : "\u25CB"}
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
            placeholderTextColor={colors.textDisabled}
            accessibilityLabel="Rate of perceived exertion, 1 to 10"
          />
        </View>
      ) : null}

      {typeModal ? (
        <SetTypeModal
          current={set.setType}
          onPick={(t) => {
            setTypeModal(false);
            props.onCommit(set.id, { setType: t });
          }}
          onClose={() => setTypeModal(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space[1] + 2, flexWrap: "wrap" },
  rowDone: { opacity: 0.72 },
  setTypeCell: { width: 30, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfacePressed, alignItems: "center", justifyContent: "center" },
  setTypeText: { ...type.bodyStrong, color: colors.text },
  setTypeTextAlt: { color: colors.accent, fontSize: 12, textTransform: "uppercase" },
  previousCell: { ...type.caption, color: colors.textMuted, width: 62, textAlign: "center", fontVariant: ["tabular-nums"] },
  cellInput: {
    backgroundColor: colors.surfacePressed,
    color: colors.text,
    borderRadius: radius.sm,
    height: 40,
    width: 60,
    textAlign: "center",
    fontSize: 15,
    paddingVertical: 0,
    fontVariant: ["tabular-nums"],
  },
  cellDone: { color: colors.textMuted },
  rpeCell: { width: 34, height: 40, alignItems: "center", justifyContent: "center" },
  rpeText: { ...type.caption, color: colors.textMuted },
  rpeTextSet: { color: colors.accent, fontWeight: "700" },
  deleteCell: { width: 24, height: 40, alignItems: "center", justifyContent: "center" },
  deleteText: { color: colors.textMuted, fontSize: 18 },
  doneBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfacePressed,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnOn: { backgroundColor: colors.successSubtle, borderColor: colors.success },
  doneGlyph: { color: colors.textMuted, fontSize: 16 },
  doneGlyphOn: { color: colors.success, fontWeight: "700" },
  detailRow: { flexDirection: "row", gap: space[2], paddingLeft: 84 },
  detailInput: {
    backgroundColor: colors.surfacePressed,
    color: colors.text,
    borderRadius: radius.sm,
    height: 36,
    width: 100,
    textAlign: "center",
    fontSize: 13,
    paddingVertical: 0,
  },
});
