import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Home placeholder (spec section 47). Phase 0 scaffold: the real screen will
 * compose the streak, weekly plan and Strength Profile from domain services.
 */
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>OpenRank</Text>
      <Text style={styles.tagline}>
        Free forever. Open source. Offline-first.
      </Text>
      <Text style={styles.note}>
        Phase 0 scaffold - workout tracking and ranks arrive in later phases.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  greeting: { ...typography.title, color: colors.text },
  tagline: { ...typography.body, color: colors.textMuted },
  note: { ...typography.caption, textAlign: "center" },
});
