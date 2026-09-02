import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { WorkoutSet, WorkoutSetInput } from "@openrank/domain";
import { fieldsForTracking } from "../../ui/tracking";
import { colors } from "../../theme/tokens";
import { SetTypeModal } from "./SetTypePicker";
import type { Units } from "./types";

/**
 * Set row (Phase 7.1 extraction, behavior-preserving): tracking-type aware
 * fields, autosave on commit, big done control, RPE/RIR detail, set-type
 * picker. Local buffers are transient input state; commits go through the
 * screen's onCommit (service layer).
 */
export function SetRow(props: {
  set: WorkoutSet;
  index: number;
  trackingType: string;
  units: Units;
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
  const [rir, setRir] = useState(set.rir == null ? "" : String(set.rir));

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
    const rirN = parseInt(rir, 10);
    input.rpe = Number.isFinite(rpeN) ? rpeN : null;
    input.rir = Number.isFinite(rirN) ? rirN : null;
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

      {fieldsForTracking(props.trackingType as never).map((f) => {
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
  row: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowDone: { opacity: 0.75 },
  setTypeCell: { width: 44, height: 40, borderRadius: 8, backgroundColor: "#1c2330", alignItems: "center", justifyContent: "center" },
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
});
