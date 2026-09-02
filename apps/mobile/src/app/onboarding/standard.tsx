import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { radius } from "../../design/radii";
import { type } from "../../design/typography";
import { useServices } from "../../services/ServicesProvider";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Ranking reference (spec 12; Phase 8.1 restyle only). Selects
 * the calibrated strength standard the frozen ranking engine actually
 * supports: male / female reference. NOT account identity, social gender or
 * legal gender.
 */
export default function OnboardingStandard() {
  const router = useRouter();
  const services = useServices();
  const profile = services.profile.getDefaultProfile();

  const choose = (standard: "male" | "female") => {
    if (!profile) return;
    services.profile.updateStrengthStandard(profile.id, standard);
    router.push("/onboarding/bodyweight");
  };

  return (
    <OnboardingShell
      step="Step 3 of 6"
      title="Ranking reference"
      subtitle="This selects the reference standard used to calculate your strength ranks."
      onBack={() => router.push("/onboarding/units")}
    >
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
        onPress={() => choose("male")}
        accessibilityLabel="Male reference standard"
      >
        <Text style={styles.optionTitle}>Male reference</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
        onPress={() => choose("female")}
        accessibilityLabel="Female reference standard"
      >
        <Text style={styles.optionTitle}>Female reference</Text>
      </Pressable>
      {profile ? (
        <Text style={styles.current}>
          Selected: {profile.strengthStandard === "male" ? "male" : "female"} reference (persists immediately)
        </Text>
      ) : null}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  option: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[4],
  },
  optionPressed: { backgroundColor: colors.surfacePressed },
  optionTitle: { ...type.cardTitle, color: colors.text, letterSpacing: 0.4 },
  current: { ...type.caption, color: colors.textSecondary },
});
