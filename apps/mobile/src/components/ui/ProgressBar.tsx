import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { colors } from "../../design/colors";
import { animationDuration } from "../../design/motion";
import { useReducedMotion } from "../../ui/useReducedMotion";

/**
 * OpenRank progress bar (Phase 8.1, spec 16): 4-8px rounded track, semantic
 * fill color (rank color for rank progress, amber for generic progress) and
 * an always-readable numeric value nearby when important. Respects reduced
 * motion: renders the final state immediately.
 */
export function ProgressBar(props: {
  value: number;
  fillColor?: string;
  height?: number;
  showValue?: boolean;
  accessibilityLabel?: string;
}) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, props.value));
  const pct = Math.round(clamped * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={props.accessibilityLabel ?? "Progress " + String(pct) + " percent"}
      style={styles.wrap}
    >
      <View style={[styles.track, { height: props.height ?? 6 }]}>
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: props.fillColor ?? colors.accent },
            useWidth(clamped, reduced),
          ]}
        />
      </View>
      {props.showValue ? <Text style={styles.value}>{String(pct) + "%"}</Text> : null}
    </View>
  );
}

/** Width animation driven by state; reduced motion snaps to the end. */
function useWidth(value: number, reduced: boolean) {
  const [width] = useState(() => new Animated.Value(reduced ? value : 0));
  useEffect(() => {
    Animated.timing(width, {
      toValue: value,
      duration: animationDuration(reduced),
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [value, reduced, width]);
  return {
    width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
  };
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  track: { flex: 1, backgroundColor: colors.surfacePressed, borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999 },
  value: { fontSize: 11, lineHeight: 14, fontWeight: "600", color: colors.textSecondary, fontVariant: ["tabular-nums"] },
});
