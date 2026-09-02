import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing } from "../../theme/tokens";
import { useServices } from "../../services/ServicesProvider";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Units (spec 11). Display preference only: canonical storage
 * stays kg / meters / seconds / UTC and ranking math is unaffected.
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
      <Pressable style={styles.card} onPress={() => choose("metric")} accessibilityLabel="Use metric units">
        <Text style={styles.cardTitle}>METRIC</Text>
        <Text style={styles.cardBody}>kg {"\u00B7"} km</Text>
      </Pressable>
      <Pressable style={styles.card} onPress={() => choose("imperial")} accessibilityLabel="Use imperial units">
        <Text style={styles.cardTitle}>IMPERIAL</Text>
        <Text style={styles.cardBody}>lb {"\u00B7"} mi</Text>
      </Pressable>
      {profile ? (
        <Text style={styles.current}>
          Selected: {profile.unitSystem === "metric" ? "kg \u00B7 km" : "lb \u00B7 mi"} (persists immediately)
        </Text>
      ) : null}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.lg, gap: 6, marginTop: spacing.sm },
  cardTitle: { color: colors.accent, fontWeight: "800", letterSpacing: 1.2 },
  cardBody: { color: colors.text, fontSize: 18, fontWeight: "600" },
  current: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
});
