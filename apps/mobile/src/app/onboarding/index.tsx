import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { resolveResumeStep } from "@openrank/database";
import { colors, spacing, typography } from "../../theme/tokens";
import { useServices } from "../../services/ServicesProvider";
import { routeForStep } from "../../features/onboarding/steps";

/**
 * Onboarding - Welcome (Phase 7.1, spec 9). Honest first screen: OpenRank is
 * free, open source and account-free, and all data stays on this device.
 * No cloud / sync / server claims - those features do not exist.
 */
export default function OnboardingWelcome() {
  const router = useRouter();
  const services = useServices();

  const start = () => {
    const profile = services.profile.getDefaultProfile();
    // Direct hits on /onboarding with progress already stored resume there.
    if (profile && !profile.onboardingCompleted) {
      router.replace(routeForStep(resolveResumeStep(profile)));
      return;
    }
    if (profile?.onboardingCompleted) {
      router.replace("/(tabs)");
      return;
    }
    router.push("/onboarding/name");
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>OpenRank</Text>
        <Text style={styles.tagline}>Train. Rank up. Stay consistent.</Text>
      </View>

      <View style={styles.points}>
        <Text style={styles.point}>Free forever.</Text>
        <Text style={styles.point}>Open source.</Text>
        <Text style={styles.point}>No account required.</Text>
      </View>

      <Text style={styles.privacy}>
        Your workout data is stored locally on this device.
      </Text>

      <Pressable style={styles.button} onPress={start} accessibilityLabel="Get started">
        <Text style={styles.buttonText}>GET STARTED</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl, justifyContent: "center", gap: spacing.xl },
  hero: { gap: spacing.sm },
  title: { ...typography.title, color: colors.text, fontSize: 42, letterSpacing: 1 },
  tagline: { ...typography.body, color: colors.textMuted, fontSize: 16 },
  points: { gap: spacing.xs },
  point: { ...typography.body, color: colors.text, fontSize: 16, fontWeight: "600" },
  privacy: { ...typography.caption, color: colors.textMuted },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  buttonText: { color: "#0b1220", fontWeight: "800", letterSpacing: 1.2 },
});
