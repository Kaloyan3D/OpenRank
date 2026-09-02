import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { resolveResumeStep } from "@openrank/database";
import { useServices } from "../../services/ServicesProvider";
import { routeForStep } from "../../features/onboarding/steps";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Onboarding - Resume (spec 21; Phase 8.1 restyle only). A process death
 * mid-onboarding lands here via the root gate; the durable onboarding_step
 * column decides the screen. No second profile is ever created - the same
 * profile continues.
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

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: space[6] },
  text: { ...type.caption, color: colors.textMuted },
});
