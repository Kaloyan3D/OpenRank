import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../../theme/tokens";

/** Profile tab placeholder (onboarding + settings arrive in later phases). */
export default function ProfileScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Profile & settings - later phases</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  text: { color: colors.textMuted },
});
