import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/** Section title row (Phase 8.1) with optional trailing action link. */
export function SectionHeader(props: { title: string; actionLabel?: string; onAction?: () => void; actionAccessibilityLabel?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{props.title}</Text>
      {props.actionLabel && props.onAction ? (
        <Text
          accessible
          accessibilityRole="button"
          accessibilityLabel={props.actionAccessibilityLabel ?? props.actionLabel}
          onPress={props.onAction}
          style={styles.action}
        >
          {props.actionLabel}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space[2] },
  title: { ...type.sectionTitle, color: colors.text },
  action: { ...type.label, color: colors.accent, textTransform: "uppercase" },
});
