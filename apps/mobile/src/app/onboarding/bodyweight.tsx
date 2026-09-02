import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing } from "../../theme/tokens";
import { useServices } from "../../services/ServicesProvider";
import { useUnits } from "../../ui/units";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Bodyweight (spec 13/14). Required for strength ranks, but
 * skippable: skip stores NOTHING fake. Entering persists immediately, and
 * re-entry/back-navigation UPDATES the single onboarding measurement in
 * place - one intentional measurement, never accidental history rows.
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
          placeholderTextColor={colors.textMuted}
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
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 22,
    minWidth: 140,
    textAlign: "center",
  },
  unit: { color: colors.textMuted, fontSize: 18 },
  note: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
});
