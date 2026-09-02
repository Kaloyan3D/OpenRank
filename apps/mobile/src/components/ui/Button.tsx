import { StyleSheet, Text, Pressable, ActivityIndicator } from "react-native";
import type { View } from "react-native";
import { forwardRef } from "react";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * OpenRank button (Phase 8.1, spec 11-13).
 * - primary: amber background, near-black text (the brand CTA)
 * - secondary: dark surface + border (VIEW PLAN / SKIP / CANCEL)
 * - danger: destructive actions (Discard / Delete) - never amber
 * Pressed uses the dedicated pressed tokens; no gradients, no glow.
 */
export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "dangerSubtle" | "ghost";
  size?: "regular" | "compact";
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  fullWidth?: boolean;
  style?: object | object[];
}

export const Button = forwardRef<View, ButtonProps>(function Button(props, ref) {
  const variant = props.variant ?? "primary";
  const compact = props.size === "compact";
  return (
    <Pressable
      ref={ref}
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: props.disabled === true, busy: props.loading === true }}
      disabled={props.disabled || props.loading}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.base,
        compact ? styles.baseCompact : null,
        variantStyles[variant],
        props.fullWidth ? styles.fullWidth : null,
        props.style,
        pressed && !props.disabled ? styles.pressed : null,
      ]}
    >
      {({ pressed }) =>
        props.loading ? (
          <ActivityIndicator color={variant === "primary" ? colors.textOnAccent : colors.accent} />
        ) : (
          <Text style={[styles.label, labelStyles[variant], pressed && !props.disabled ? styles.labelPressed : null]}>
            {props.label}
          </Text>
        )
      }
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: space[5],
    alignItems: "center",
    justifyContent: "center",
  },
  baseCompact: { minHeight: 40, paddingHorizontal: space[4] },
  fullWidth: { alignSelf: "stretch" },
  pressed: { opacity: 0.92 },
  label: { ...type.bodyStrong, letterSpacing: 0.4 },
  labelPressed: { opacity: 0.95 },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  danger: { backgroundColor: colors.danger },
  dangerSubtle: { backgroundColor: colors.dangerSubtle, borderWidth: 1, borderColor: colors.danger },
  ghost: { backgroundColor: "transparent" },
});

const labelStyles = StyleSheet.create({
  primary: { color: colors.textOnAccent },
  secondary: { color: colors.text },
  danger: { color: "#FFFFFF" },
  dangerSubtle: { color: colors.danger },
  ghost: { color: colors.accent },
});
