import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../../theme/tokens";

/** History tab placeholder (workout history arrives in Phase 4). */
export default function HistoryScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Workout history - Phase 4</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  text: { color: colors.textMuted },
});
