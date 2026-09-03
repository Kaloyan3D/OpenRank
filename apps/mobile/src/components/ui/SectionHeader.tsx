import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Section title row (Phase 8.2B, guide sections 7/37): 18/24 semibold
 * title with an optional trailing action link (amber, 15/21 semibold,
 * comfortable touch target). Hierarchy comes from the type scale - not
 * from shouty caps or extra borders.
 */
export function SectionHeader(props: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  actionAccessibilityLabel?: string;
  style?: object | object[];
}) {
  return (
    <View style={[styles.row, props.style]}>
      <Text style={styles.title}>{props.title}</Text>
      {props.actionLabel && props.onAction ? (
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={props.actionAccessibilityLabel ?? props.actionLabel}
          onPress={props.onAction}
          hitSlop={6}
          style={styles.actionHit}
        >
          <Text style={styles.action}>{props.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space[3] },
  title: { ...type.sectionTitle, color: colors.text, flexShrink: 1 },
  actionHit: { minHeight: 44, justifyContent: "center" },
  action: { ...type.body, fontWeight: "600", color: colors.accent },
});
