import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";

/**
 * OpenRank card (Phase 8.1, spec 14): surface + 1px border + radius 12.
 * "elevated" variant (SURFACE_ELEVATED) is reserved for the primary
 * dashboard card; avoid nesting cards inside cards.
 */
export function Card(props: {
  children: ReactNode;
  variant?: "default" | "elevated" | "subtle" | "hero";
  accessibilityLabel?: string;
  style?: object | object[];
}) {
  return (
    <View
      style={[styles.base, variantStyles[props.variant ?? "default"], props.style]}
      accessible={props.accessibilityLabel != null}
      accessibilityLabel={props.accessibilityLabel}
    >
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 12, padding: space[4], borderWidth: 1 },
});

const variantStyles = StyleSheet.create({
  default: { backgroundColor: colors.surface, borderColor: colors.border },
  elevated: { backgroundColor: colors.surfaceElevated, borderColor: colors.borderStrong },
  subtle: { backgroundColor: colors.bgSubtle, borderColor: colors.border },
  // Hero card (guide section 12): the ONE dominant card near the top of the
  // viewport - elevated surface, slightly larger radius, quiet border.
  hero: { backgroundColor: colors.surfaceElevated, borderColor: colors.border, borderRadius: radius.lg },
});
