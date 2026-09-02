import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { resolveResumeStep } from "@openrank/database";
import { useServices } from "../../services/ServicesProvider";
import { routeForStep } from "../../features/onboarding/steps";
import { Button } from "../../components/ui/Button";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Onboarding - Welcome (Phase 7.1, spec 9; Phase 8.1 restyle - design tokens
 * only, all copy/navigation untouched). Honest first screen: OpenRank is
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
        <Text style={styles.brand}>OpenRank</Text>
        <Text style={styles.tagline}>Train. Rank up. Stay consistent.</Text>
      </View>

      <View style={styles.points}>
        <Text style={styles.point}>Free forever.</Text>
        <Text style={styles.point}>Open source.</Text>
        <Text style={styles.point}>No account required.</Text>
      </View>

      <Text style={styles.privacy}>Your workout data is stored locally on this device.</Text>

      <Button label="GET STARTED" variant="primary" onPress={start} fullWidth accessibilityLabel="Get started" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: space[4],
    paddingVertical: space[6],
    justifyContent: "center",
    gap: space[6],
  },
  hero: { gap: space[3] },
  brand: { ...type.display, color: colors.text, letterSpacing: 0.5 },
  tagline: { ...type.caption, color: colors.textMuted },
  points: { gap: space[2] },
  point: { ...type.bodyStrong, color: colors.text },
  privacy: { ...type.caption, color: colors.textMuted },
});
