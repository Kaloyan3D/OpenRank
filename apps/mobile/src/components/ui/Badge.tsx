import { StyleSheet, Text, View } from "react-native";
import { colors, withAlpha } from "../../design/colors";
import { radius } from "../../design/radii";
import { type } from "../../design/typography";

/**
 * Compact status badge (Phase 8.2B, guide sections 3.2/9): a small label on
 * a 12% tint of its color. Amber = OpenRank highlight (PR); rank colors are
 * passed in only where rank semantics apply (RANK UP). Never interactive.
 */
export function Badge(props: { label: string; color?: string; style?: object | object[] }) {
  const tint = props.color ?? colors.accent;
  return (
    <View style={[styles.badge, { backgroundColor: withAlpha(tint, 0.12) }, props.style]}>
      <Text style={[styles.text, { color: tint }]}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  text: { ...type.label, letterSpacing: 0.4 },
});
