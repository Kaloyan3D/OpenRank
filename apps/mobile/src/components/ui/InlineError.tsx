import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * User-safe inline error (Phase 8.1, spec 40): never exposes raw SQLite or
 * internal errors; pairs a short explanation with an optional retry action.
 */
export function InlineError(props: { message: string; retryLabel?: string; onRetry?: () => void }) {
  return (
    <View accessible accessibilityRole="alert" style={styles.wrap}>
      <Text style={styles.message}>{props.message}</Text>
      {props.retryLabel && props.onRetry ? (
        <Text
          accessible
          accessibilityRole="button"
          accessibilityLabel={props.retryLabel}
          onPress={props.onRetry}
          style={styles.retry}
        >
          {props.retryLabel}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.dangerSubtle,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space[3],
    gap: space[2],
  },
  message: { ...type.caption, color: colors.danger },
  retry: { ...type.label, color: colors.text, textTransform: "uppercase" },
});
