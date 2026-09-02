import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { formatDuration } from "../../ui/format";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Active workout header (Phase 8.1, spec 22): back arrow, workout name,
 * amber tabular timer (derived, never stored) and workout notes with
 * autosave on end-editing. Finish lives with the finish flow (amber text
 * action) - never styled as destructive.
 */
export function WorkoutHeader(props: {
  title: string;
  startedAt: string;
  finishedAt: string | null;
  notes: string | null;
  onNotes: (notes: string | null) => void;
  onBack?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {props.onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to workout hub"
            onPress={props.onBack}
            style={styles.backBtn}
          >
            <Text style={styles.backText}>{"\u2190"}</Text>
          </Pressable>
        ) : null}
        <Text style={[styles.title, !props.onBack ? styles.titleNoBack : null]} numberOfLines={1}>
          {props.title}
        </Text>
        <WorkoutTimer startedAt={props.startedAt} finishedAt={props.finishedAt} />
      </View>
      <TextInput
        style={styles.notes}
        placeholder="Workout notes..."
        placeholderTextColor={colors.textMuted}
        defaultValue={props.notes ?? ""}
        multiline
        accessibilityLabel="Workout notes"
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
    <Text
      style={styles.timer}
      accessibilityLabel={"Workout duration " + formatDuration(Math.max(0, Math.round((end - Date.parse(props.startedAt)) / 1000)))}
    >
      {formatDuration(Math.max(0, Math.round((end - Date.parse(props.startedAt)) / 1000)))}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  row: { flexDirection: "row", alignItems: "center", gap: space[2] },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { ...type.bodyStrong, color: colors.text },
  title: { ...type.sectionTitle, color: colors.text, flex: 1 },
  titleNoBack: { marginLeft: 0 },
  timer: { ...type.metricSmall, color: colors.accent, fontVariant: ["tabular-nums"] },
  notes: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space[2] + 2,
    minHeight: 40,
    fontSize: 14,
  },
});
