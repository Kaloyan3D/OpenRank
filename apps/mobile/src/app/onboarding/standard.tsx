import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing } from "../../theme/tokens";
import { useServices } from "../../services/ServicesProvider";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Ranking reference (spec 12). Selects the calibrated strength
 * standard the frozen ranking engine actually supports: male / female
 * reference. NOT account identity, social gender or legal gender.
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
      <Pressable style={styles.card} onPress={() => choose("male")} accessibilityLabel="Male reference standard">
        <Text style={styles.cardTitle}>Male reference</Text>
      </Pressable>
      <Pressable style={styles.card} onPress={() => choose("female")} accessibilityLabel="Female reference standard">
        <Text style={styles.cardTitle}>Female reference</Text>
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
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.lg, marginTop: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  current: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
});
