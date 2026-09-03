import { StyleSheet, View } from "react-native";
import { colors } from "../../design/colors";

/**
 * Hairline separator (Phase 8.2B, guide section 9): quiet row separation
 * inside grouped surfaces - instead of boxing every row. Optional start
 * inset aligns the line with row content.
 */
export function Divider(props: { inset?: number; style?: object | object[] }) {
  return <View style={[styles.base, props.inset ? { marginStart: props.inset } : null, props.style]} />;
}

const styles = StyleSheet.create({
  base: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, alignSelf: "stretch" },
});
