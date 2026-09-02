import { useEffect, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors } from "../theme/tokens";

/**
 * Animated 0..1 progress fill (Phase 8 polish): draws in on mount whenever
 * the value changes. Used by rank cards and achievement tiles.
 */
export function AnimatedProgress(props: { value: number; height?: number }) {
  const [width] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(width, {
      toValue: Math.max(0, Math.min(1, props.value)),
      duration: 460,
      useNativeDriver: false,
    }).start();
  }, [props.value, width]);

  return (
    <View
      accessible
      accessibilityLabel={"Progress " + String(Math.round(props.value * 100)) + " percent"}
      style={[styles.track, { height: props.height ?? 6 }]}
    >
      <Animated.View style={[styles.fill, { width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden", width: "100%" },
  fill: { backgroundColor: colors.accent, height: "100%", borderRadius: 4 },
});
