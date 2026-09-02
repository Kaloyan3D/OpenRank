import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { radius } from "../../design/radii";
import { type } from "../../design/typography";
import { useServices } from "../../services/ServicesProvider";
import { useUnits } from "../../ui/units";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Bodyweight (spec 13/14; Phase 8.1 restyle only). Required for
 * strength ranks, but skippable: skip stores NOTHING fake. Entering persists
 * immediately, and re-entry/back-navigation UPDATES the single onboarding
 * measurement in place - one intentional measurement, never accidental
 * history rows.
 */
export default function OnboardingBodyweight() {
  const router = useRouter();
  const services = useServices();
  const units = useUnits();
  const profile = services.profile.getDefaultProfile();

  const existing = profile ? services.profile.getOnboardingBodyweight(profile.id) : null;
  const [text, setText] = useState(existing ? units.toDisplay(existing.weightKg) : "");

  const submit = () => {
    if (!profile) return;
    const kg = units.fromDisplay(text);
    if (kg == null || kg <= 0 || !Number.isFinite(kg)) {
      Alert.alert("Invalid bodyweight", "Enter a positive number in " + units.weightLabel + ".");
      return;
    }
    services.profile.setOnboardingBodyweight(profile.id, Math.round(kg * 1000) / 1000, new Date().toISOString());
    router.push("/onboarding/days");
  };

  const skip = () => {
    // Store nothing - ranks stay unavailable until a real measurement exists.
    router.push("/onboarding/days");
  };

  return (
    <OnboardingShell
      step="Step 4 of 6"
      title="What's your current bodyweight?"
      subtitle={"Bodyweight is required to calculate strength ranks. You can still track workouts without it."}
      onContinue={() => submit()}
      continueDisabled={text.trim().length === 0}
      secondaryLabel="SKIP FOR NOW"
      onSecondary={skip}
      onBack={() => router.push("/onboarding/standard")}
    >
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          placeholder={"0"}
          placeholderTextColor={colors.textDisabled}
          accessibilityLabel={"Current bodyweight in " + units.weightLabel}
        />
        <Text style={styles.unit}>{units.weightLabel}</Text>
      </View>
      {existing ? (
        <Text style={styles.note}>
          {"Stored: " + units.toDisplay(existing.weightKg) + " " + units.weightLabel + " - continuing updates this measurement instead of adding a new one."}
        </Text>
      ) : null}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  input: {
    backgroundColor: colors.surfacePressed,
    color: colors.text,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    minHeight: 44,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    minWidth: 150,
    fontSize: type.metricMedium.fontSize,
    fontWeight: type.metricMedium.fontWeight,
    lineHeight: type.metricMedium.lineHeight,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  unit: { ...type.bodyStrong, color: colors.textSecondary },
  note: { ...type.caption, color: colors.textMuted },
});
