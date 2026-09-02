import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { radius } from "../../design/radii";
import { type } from "../../design/typography";
import { useServices } from "../../services/ServicesProvider";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Units (spec 11; Phase 8.1 restyle only). Display preference
 * only: canonical storage stays kg / meters / seconds / UTC and ranking
 * math is unaffected.
 */
export default function OnboardingUnits() {
  const router = useRouter();
  const services = useServices();
  const profile = services.profile.getDefaultProfile();

  const choose = (system: "metric" | "imperial") => {
    if (!profile) return;
    services.profile.updateUnitSystem(profile.id, system);
    router.push("/onboarding/standard");
  };

  return (
    <OnboardingShell
      step="Step 2 of 6"
      title="Units"
      subtitle="Display only - everything is stored canonically and ranks are unaffected."
      onBack={() => router.push("/onboarding/name")}
    >
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
        onPress={() => choose("metric")}
        accessibilityLabel="Use metric units"
      >
        <Text style={styles.optionTitle}>METRIC</Text>
        <Text style={styles.optionBody}>kg {"·"} km</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
        onPress={() => choose("imperial")}
        accessibilityLabel="Use imperial units"
      >
        <Text style={styles.optionTitle}>IMPERIAL</Text>
        <Text style={styles.optionBody}>lb {"·"} mi</Text>
      </Pressable>
      {profile ? (
        <Text style={styles.current}>
          Selected: {profile.unitSystem === "metric" ? "kg · km" : "lb · mi"} (persists immediately)
        </Text>
      ) : null}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[4],
  },
  optionPressed: { backgroundColor: colors.surfacePressed },
  optionTitle: { ...type.cardTitle, color: colors.text, letterSpacing: 0.8 },
  optionBody: { ...type.bodyStrong, color: colors.textSecondary },
  current: { ...type.caption, color: colors.textSecondary },
});
