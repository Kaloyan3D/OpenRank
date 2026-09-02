import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { radius } from "../../design/radii";
import { type } from "../../design/typography";
import { useServices } from "../../services/ServicesProvider";
import { Card } from "../../components/ui/Card";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Ready (spec 20; Phase 8.1 restyle only). The ONLY screen
 * whose explicit action sets onboarding_completed = true, then routes to the
 * main tabs.
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
      <Card variant="elevated" style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.kicker}>Profile</Text>
          <Text style={styles.value}>{profile.displayName}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.kicker}>Training</Text>
          <Text style={styles.value}>
            {enabledDays.length > 0 ? enabledDays.join(" · ") : "No scheduled days yet"}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.kicker}>Strength ranks</Text>
          <Text style={styles.value}>
            {bodyweight
              ? "Ready (" + String(bodyweight.weightKg) + " kg reference)"
              : "Add bodyweight later"}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.kicker}>Reminders</Text>
          <Text style={styles.value}>{remindersOn ? "Enabled" : "Off"}</Text>
        </View>
      </Card>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: space[4],
    gap: space[3],
  },
  row: { gap: space[1] },
  kicker: { ...type.label, color: colors.textMuted, letterSpacing: 1.2, textTransform: "uppercase" },
  value: { ...type.body, color: colors.text },
});
