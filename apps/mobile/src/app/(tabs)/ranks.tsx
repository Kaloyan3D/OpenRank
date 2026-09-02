import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../../theme/tokens";

/**
 * Ranks tab placeholder. Will display the Strength Profile (per muscle group)
 * - never an averaged overall rank (overall rank stays disabled).
 */
export default function RanksScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Strength Profile - Phase 5</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  text: { color: colors.textMuted },
});
