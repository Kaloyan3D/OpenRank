import { useEffect } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { resolveResumeStep } from "@openrank/database";
import { useServices } from "../../services/ServicesProvider";
import { routeForStep } from "../../features/onboarding/steps";
import { colors } from "../../theme/tokens";

/**
 * Onboarding - Resume (spec 21). A process death mid-onboarding lands here
 * via the root gate; the durable onboarding_step column decides the screen.
 * No second profile is ever created - the same profile continues.
 */
export default function OnboardingResume() {
  const router = useRouter();
  const services = useServices();

  useEffect(() => {
    const profile = services.profile.getDefaultProfile();
    if (!profile) {
      router.replace("/onboarding");
      return;
    }
    if (profile.onboardingCompleted) {
      router.replace("/(tabs)");
      return;
    }
    router.replace(routeForStep(resolveResumeStep(profile)));
  }, [router, services]);

  return (
    <View style={styles.center}>
      <Text style={styles.text}>Resuming onboarding...</Text>
    </View>
  );
}

const styles = {
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  text: { color: colors.textMuted },
} as const;
