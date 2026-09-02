import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { radius } from "../../design/radii";
import { type } from "../../design/typography";
import { useServices } from "../../services/ServicesProvider";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Training days (spec 15; Phase 8.1 restyle only). Reuses
 * ScheduleService entirely: setScheduleEnabled(true) + updateWeeklySchedule
 * over all 7 weekdays. Zero selected days is VALID onboarding - no forced
 * obligations. Selected days are filled amber circles; unselected days are
 * neutral surface circles.
 */

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

export default function OnboardingDays() {
  const router = useRouter();
  const services = useServices();
  const profile = services.profile.getDefaultProfile();
  const existing = profile ? services.schedule.getSchedule(profile.id).days : null;
  const [selected, setSelected] = useState<boolean[]>(
    existing ? existing.map((d) => d.enabled) : [false, false, false, false, false, false, false],
  );

  const toggle = (i: number) => {
    setSelected((prev) => prev.map((v, j) => (j === i ? !v : v)));
  };

  const save = () => {
    if (!profile) return;
    services.schedule.setScheduleEnabled(profile.id, true, {
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    services.schedule.updateWeeklySchedule(
      profile.id,
      selected.map((enabled, i) => ({
        weekday: (i + 1) as 1,
        enabled,
        routineId: existing?.[i]?.routineId ?? null, // keep any existing association
      })),
      { timezoneOffsetMinutes: -new Date().getTimezoneOffset() },
    );
    router.push("/onboarding/review");
  };

  return (
    <OnboardingShell
      step="Step 5 of 6"
      title="Which days do you usually train?"
      subtitle={"Zero days is fine - you can configure your schedule anytime. Rest days never break your streak."}
      onContinue={() => save()}
      onBack={() => router.push("/onboarding/bodyweight")}
      continueLabel={selected.some(Boolean) ? "SAVE PLAN" : "CONTINUE WITHOUT PLAN"}
    >
      <View style={styles.grid}>
        {DAY_LABELS.map((label, i) => (
          <Pressable
            key={label}
            onPress={() => toggle(i)}
            style={({ pressed }) => [
              styles.day,
              selected[i] ? styles.dayOn : null,
              pressed ? styles.dayPressed : null,
            ]}
            accessibilityLabel={label + (selected[i] ? " selected" : " not selected")}
            accessibilityRole="button"
          >
            <Text style={[styles.dayText, selected[i] ? styles.dayTextOn : null]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>
        {selected.filter(Boolean).length === 0
          ? "No training days selected - you can add them later."
          : selected.filter(Boolean).length + " training day(s) selected."}
      </Text>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  day: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayPressed: { opacity: 0.85 },
  dayText: { ...type.label, color: colors.textSecondary, letterSpacing: 1 },
  dayTextOn: { color: colors.textOnAccent },
  note: { ...type.caption, color: colors.textMuted },
});
