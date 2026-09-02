import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useServices } from "../../services/ServicesProvider";
import { colors, spacing } from "../../theme/tokens";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Ready (spec 20). The ONLY screen whose explicit action sets
 * onboarding_completed = true, then routes to the main tabs.
 */

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export default function OnboardingReady() {
  const router = useRouter();
  const services = useServices();
  const profile = services.profile.getDefaultProfile();
  if (!profile) return null;

  const enabledDays = services.schedule
    .getSchedule(profile.id)
    .days.filter((d) => d.enabled)
    .map((d) => DAY_NAMES[d.weekday - 1]!);
  const bodyweight = services.profile.getOnboardingBodyweight(profile.id);
  const prefs = services.notifications.getPreferences(profile.id);
  const remindersOn = prefs.trainingRemindersEnabled;

  const start = () => {
    services.profile.completeOnboarding(profile.id);
    router.replace("/(tabs)");
  };

  return (
    <OnboardingShell
      step="All set"
      title="YOU'RE READY"
      onContinue={() => start()}
      continueLabel="START OPENRANK"
      onBack={() => router.push("/onboarding/reminders")}
    >
      <View style={styles.card}>
        <Text style={styles.kicker}>Profile</Text>
        <Text style={styles.value}>{profile.displayName}</Text>

        <Text style={styles.kicker}>Training</Text>
        <Text style={styles.value}>
          {enabledDays.length > 0 ? enabledDays.join(" \u00B7 ") : "No scheduled days yet"}
        </Text>

        <Text style={styles.kicker}>Strength ranks</Text>
        <Text style={styles.value}>
          {bodyweight
            ? "Ready (" + String(bodyweight.weightKg) + " kg reference)"
            : "Add bodyweight later"}
        </Text>

        <Text style={styles.kicker}>Reminders</Text>
        <Text style={styles.value}>{remindersOn ? "Enabled" : "Off"}</Text>
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.lg, gap: 6, marginTop: spacing.sm },
  kicker: { color: colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginTop: spacing.sm },
  value: { color: colors.text, fontSize: 17, fontWeight: "600" },
});
