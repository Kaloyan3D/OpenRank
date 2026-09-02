import { useState } from "react";
import type { ReactNode } from "react";
import { Animated, Pressable } from "react-native";

/**
 * Press feedback with a subtle scale (Phase 8 polish): 0.98 on press-in,
 * spring back on release. Accessibility role/label pass through.
 */
export function PressableScale(props: {
  onPress: () => void;
  children: ReactNode;
  accessibilityLabel?: string;
  disabled?: boolean;
  style?: object | object[];
}) {
  const [scale] = useState(() => new Animated.Value(1));
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityLabel={props.accessibilityLabel}
      onPressIn={() => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 40 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30 }).start()}
    >
      <Animated.View style={[props.style, { transform: [{ scale }] }]}>{props.children}</Animated.View>
    </Pressable>
  );
}
