import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing } from "../../theme/tokens";
import { useServices } from "../../services/ServicesProvider";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Training plan review (spec 16). Zero days is a valid,
 * neutral outcome: "No scheduled training days yet."
 */

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export default function OnboardingReview() {
  const router = useRouter();
  const services = useServices();
  const profile = services.profile.getDefaultProfile();
  const days = profile ? services.schedule.getSchedule(profile.id).days : [];
  const enabled = days.filter((d) => d.enabled).map((d) => DAY_NAMES[d.weekday - 1]!);

  return (
    <OnboardingShell
      step="Step 5 of 6"
      title="YOUR PLAN"
      onContinue={() => router.push("/onboarding/reminders")}
      onBack={() => router.push("/onboarding/days")}
      continueLabel={enabled.length > 0 ? "LOOKS GOOD" : "CONTINUE"}
    >
      <View style={styles.planCard}>
        {enabled.length > 0 ? (
          <>
            <Text style={styles.planText}>{enabled.join(" \u00B7 ")}</Text>
            <Text style={styles.planNote}>Rest days don't break your streak.</Text>
          </>
        ) : (
          <>
            <Text style={styles.planText}>No scheduled training days yet.</Text>
            <Text style={styles.planNote}>You can configure your schedule later.</Text>
          </>
        )}
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  planText: { color: colors.text, fontSize: 24, fontWeight: "800", letterSpacing: 1 },
  planNote: { color: colors.textMuted, fontSize: 13 },
});
