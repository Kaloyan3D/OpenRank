import { StyleSheet, Text, View } from "react-native";
import { rankColor } from "../../design/rank-colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Rank badge (Phase 8.1, spec 30): tier + division text on a rank-colored
 * subtle plate. Rank color NEVER stands alone - the tier text is always
 * present, division when applicable.
 */
export function RankBadge(props: { tierName: string | null; division?: string | null; size?: "sm" | "md" }) {
  const color = rankColor(props.tierName);
  const small = props.size === "sm";
  if (!props.tierName) {
    return (
      <View style={[styles.badge, small ? styles.sm : null, { backgroundColor: "rgba(107,114,128,0.12)" }]}>
        <Text style={[styles.text, small ? styles.textSm : null, { color: "#6B7280" }]}>No rank</Text>
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={"Rank " + props.tierName + (props.division ? " " + props.division : "")}
      style={[styles.badge, small ? styles.sm : null, { backgroundColor: hexToSubtle(color) }]}
    >
      <Text style={[styles.text, small ? styles.textSm : null, { color }]}>
        {props.tierName + (props.division ? " " + props.division : "")}
      </Text>
    </View>
  );
}

/** Deterministic subtle plate from a solid rank color (12% alpha). */
function hexToSubtle(hex: string): string {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  if (!m) return "rgba(107,114,128,0.12)";
  const r = parseInt(m[1]!.slice(0, 2), 16);
  const g = parseInt(m[1]!.slice(2, 4), 16);
  const b = parseInt(m[1]!.slice(4, 6), 16);
  return "rgba(" + String(r) + "," + String(g) + "," + String(b) + ",0.12)";
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: space[2] + 2,
    paddingVertical: 3,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "transparent",
  },
  sm: { paddingVertical: 1, paddingHorizontal: 6 },
  text: { ...type.label, letterSpacing: 0.4 },
  textSm: { fontSize: 10, lineHeight: 13 },
});
