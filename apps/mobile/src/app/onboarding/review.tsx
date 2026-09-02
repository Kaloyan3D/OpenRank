import { StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { radius } from "../../design/radii";
import { type } from "../../design/typography";
import { useServices } from "../../services/ServicesProvider";
import { Card } from "../../components/ui/Card";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Training plan review (spec 16; Phase 8.1 restyle only). Zero
 * days is a valid, neutral outcome: "No scheduled training days yet."
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
      <Card variant="elevated" style={styles.planCard}>
        {enabled.length > 0 ? (
          <>
            <Text style={styles.planDays}>{enabled.join(" · ")}</Text>
            <Text style={styles.planNote}>Rest days don't break your streak.</Text>
          </>
        ) : (
          <>
            <Text style={styles.planDays}>No scheduled training days yet.</Text>
            <Text style={styles.planNote}>You can configure your schedule later.</Text>
          </>
        )}
      </Card>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  planCard: {
    borderRadius: radius.lg,
    padding: space[4],
    gap: space[2],
  },
  planDays: { ...type.cardTitle, color: colors.text, letterSpacing: 0.4 },
  planNote: { ...type.caption, color: colors.textMuted },
});
