import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Animated, Easing } from "react-native";
import { colors } from "../design/colors";
import { animationDuration } from "../design/motion";
import { useReducedMotion } from "./useReducedMotion";

/**
 * Animated progress bar (Phase 8.1): rank/generic fill; reduced motion
 * renders the final state immediately (pure policy in design/motion.ts).
 */
export function AnimatedProgress(props: { value: number; fillColor?: string }) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, props.value));
  const [width] = useState(() => new Animated.Value(reduced ? clamped : 0));
  useEffect(() => {
    Animated.timing(width, {
      toValue: clamped,
      duration: animationDuration(reduced),
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [clamped, reduced, width]);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={"Progress " + String(Math.round(clamped * 100)) + " percent"}
      style={styles.track}
    >
      <Animated.View
        style={[
          styles.fill,
          { backgroundColor: props.fillColor ?? colors.accent },
          {
            width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, backgroundColor: colors.surfacePressed, borderRadius: 999, overflow: "hidden", marginVertical: 8 },
  fill: { height: "100%", borderRadius: 999 },
});
