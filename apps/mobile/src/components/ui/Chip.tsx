import { Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * OpenRank chip (Phase 8.1, spec 15): filters / ranges / selected training
 * days. Selected = subtle amber fill + amber border + amber text; default =
 * surface + neutral border/text. Selection is never color alone (pressed +
 * accessibility state are wired).
 */
export function Chip(props: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Optional touch inset (e.g. dense filter rows reach the 44dp target). */
  hitSlop?: PressableProps["hitSlop"];
}) {
  return (
    <Pressable
      accessible
      hitSlop={props.hitSlop}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ selected: props.selected === true, disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.base,
        props.selected ? styles.selected : styles.default,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.label, props.selected ? styles.labelSelected : styles.labelDefault]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: space[4],
    borderWidth: 1,
    minHeight: 36,
    justifyContent: "center",
  },
  default: { backgroundColor: colors.surface, borderColor: colors.border },
  selected: { backgroundColor: colors.accentSubtle, borderColor: colors.accent },
  pressed: { backgroundColor: colors.surfacePressed },
  label: { ...type.label, letterSpacing: 0.3 },
  labelDefault: { color: colors.textSecondary },
  labelSelected: { color: colors.accent },
});
