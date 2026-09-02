/**
 * Rest timer bar (Phase 4, tasks O/P).
 *
 * Pure view over the persisted timer state: remaining time is derived from
 * ends_at on every tick. -15 / +15 / Skip call the service (persisted
 * immediately); expiry keeps the bar visible with a "done" state until the
 * user skips or a new rest starts.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
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
      <Text style={styles.label} accessibilityLabel={rest.expired ? "Rest complete" : "Rest timer"}>
        {rest.expired ? "REST COMPLETE" : "REST"}
      </Text>
      <Text style={styles.time}>{rest.expired ? "done" : formatDuration(rest.remainingSeconds)}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Subtract 15 seconds from rest"
          onPress={() => props.onAdjust(-15)}
          style={styles.chip}
        >
          <Text style={styles.chipText}>-15s</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Add 15 seconds to rest"
          onPress={() => props.onAdjust(15)}
          style={styles.chip}
        >
          <Text style={styles.chipText}>+15s</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Skip rest timer"
          onPress={props.onSkip}
          style={[styles.chip, styles.skip]}
        >
          <Text style={[styles.chipText, styles.skipText]}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#12314e",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
  },
  expired: { backgroundColor: "#1d3a25" },
  label: { color: "#8ab4e0", fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  time: { color: "#e8eef5", fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"], minWidth: 74 },
  actions: { flexDirection: "row", gap: 8, marginLeft: "auto" },
  chip: {
    borderWidth: 1,
    borderColor: "#3a5a7c",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { color: "#cfe2f5", fontSize: 13 },
  skip: { borderColor: "#a05a5a" },
  skipText: { color: "#e8a0a0" },
});
