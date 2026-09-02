import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { formatDuration } from "../../ui/format";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Workout header (Phase 7.1 extraction, behavior-preserving): title, the
 * derived duration timer (never stored, ticks from started_at) and workout
 * notes (autosave on end-editing).
 */
export function WorkoutHeader(props: {
  title: string;
  startedAt: string;
  finishedAt: string | null;
  notes: string | null;
  onNotes: (notes: string | null) => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.title}>{props.title}</Text>
        <WorkoutTimer startedAt={props.startedAt} finishedAt={props.finishedAt} />
      </View>
      <TextInput
        style={styles.notes}
        placeholder="Workout notes..."
        placeholderTextColor={colors.textMuted}
        defaultValue={props.notes ?? ""}
        multiline
        onEndEditing={(e) => props.onNotes(e.nativeEvent.text.trim() || null)}
      />
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

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center" },
  title: { ...typography.title, color: colors.text, flex: 1 },
  timer: { color: colors.accent, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  notes: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    padding: spacing.sm,
    minHeight: 40,
    fontSize: 13,
  },
});
