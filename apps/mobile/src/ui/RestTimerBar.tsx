/**
 * Rest timer bar (Phase 4 tasks O/P; Phase 8.1 approved styling, spec 27).
 *
 * Pure view over the persisted timer state: remaining time is derived from
 * ends_at on every tick. -15 / +15 / Skip call the service (persisted
 * immediately); expiry keeps the bar visible with a "done" state until the
 * user skips or a new rest starts. Semantics unchanged.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../design/colors";
import { radius } from "../design/radii";
import { space } from "../design/spacing";
import { type } from "../design/typography";
import { formatDuration } from "./format";

export interface RestBarState {
  remainingSeconds: number;
  expired: boolean;
  endsAt: string;
}

export function RestTimerBar(props: {
  rest: RestBarState;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
}) {
  const { rest } = props;
  return (
    <View style={[styles.bar, rest.expired ? styles.expired : null]}>
      <View accessible accessibilityLabel={rest.expired ? "Rest complete" : "Rest timer"}>
        <Text style={styles.label}>{rest.expired ? "REST COMPLETE" : "REST"}</Text>
        <Text style={styles.time}>{rest.expired ? "done" : formatDuration(rest.remainingSeconds)}</Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Subtract 15 seconds from rest"
          accessibilityRole="button"
          onPress={() => props.onAdjust(-15)}
          style={[styles.chip, styles.minus]}
        >
          <Text style={[styles.chipText, styles.minusText]}>-15</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Skip rest timer"
          accessibilityRole="button"
          onPress={props.onSkip}
          style={[styles.chip, styles.skip]}
        >
          <Text style={[styles.chipText, styles.skipText]}>SKIP</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Add 15 seconds to rest"
          accessibilityRole="button"
          onPress={() => props.onAdjust(15)}
          style={[styles.chip, styles.plus]}
        >
          <Text style={[styles.chipText, styles.plusText]}>+15</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[3],
  },
  expired: { borderColor: colors.success },
  label: { ...type.label, color: colors.textMuted, letterSpacing: 1.2 },
  time: { ...type.metricMedium, color: colors.text, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", gap: space[2], marginLeft: "auto" },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    minHeight: 36,
    justifyContent: "center",
  },
  minus: { backgroundColor: colors.dangerSubtle, borderColor: colors.danger },
  minusText: { color: colors.danger, fontWeight: "700" },
  skip: { backgroundColor: colors.surfacePressed, borderColor: colors.borderStrong },
  skipText: { color: colors.text, fontWeight: "700" },
  plus: { backgroundColor: colors.accentSubtle, borderColor: colors.accent },
  plusText: { color: colors.accent, fontWeight: "700" },
  chipText: { ...type.caption, fontWeight: "700" },
});
